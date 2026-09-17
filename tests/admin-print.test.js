const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const receipt = require("../admin/order-receipt.js");
const source = fs.readFileSync(require.resolve("../admin/admin.js"), "utf8");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fixture = (overrides = {}) => ({
  id: "synthetic-id", order_number: 271, customer_name: "Cliente fictício",
  status: "new", delivery_method: "Retirada", payment_method: "PIX",
  subtotal: 39, delivery_fee: 0, total: 39,
  order_items: [{ quantity: 3, product_name: "Produto de teste", line_total: 39 }],
  ...overrides
});

function canvasFactory() {
  const calls = [];
  const images = [];
  const rectangles = [];
  const context = {
    font: "", measureText(value) { return { width: Array.from(value).length * parseInt(this.font.match(/(\d+)px/)[1]) * 0.55 }; },
    fillText(value, x, y) { calls.push({ value, x, y, font: this.font, align: this.textAlign }); },
    fillRect(x, y, width, height) { rectangles.push({ x, y, width, height }); },
    drawImage(image, x, y) { images.push({ image, x, y }); },
    getImageData() { return { data: new Uint8ClampedArray([110, 0, 25, 255, 255, 225, 228, 255, 255, 128, 164, 255]) }; },
    putImageData(pixels) { assert.deepEqual([...pixels.data], [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]); }
  };
  return { width: 0, height: 0, calls, images, rectangles, getContext: () => context,
    toBlob(callback, type) { callback(new Blob(["synthetic PNG"], { type })); } };
}
function render(order, logo = null) {
  return receipt.renderOrderReceiptCanvas(receipt.buildOrderReceiptData(order), { money, logo, createCanvas: canvasFactory });
}

function harness(orderList = [fixture()], receiptOverrides = {}) {
  const listeners = {};
  const buttons = new Map(orderList.map(order => [order.id, { disabled: false, setAttribute() {} }]));
  const actions = [];
  const context = {
    orders: orderList, selectedOrderStatuses: new Set(["new"]), printingOrderIds: new Set(),
    ordersList: { innerHTML: "", addEventListener: (event, callback) => { listeners[event] = callback; },
      querySelector: selector => buttons.get(selector.match(/="([^"]+)"/)[1]) },
    updateOrderStatusFilterControls() {}, updatePendingOrdersIndicator() {},
    getFilteredOrders: () => orderList, escapeHtml: value => String(value || ""), formatDate: () => "",
    buildDeliveryCostsHtml: () => "", ORDER_STATUS_LABELS: {}, CANCELLATION_REASON_LABELS: {}, PAYMENT_STATUS_LABELS: {},
    BRL: money, CSS: { escape: value => value }, receiptLogo: Promise.resolve(null), ordersMessage: {},
    MimoOrderReceipt: { ...receipt, renderOrderReceiptCanvas: data => ({ data }),
      canvasToPngFile: async (canvas, number) => ({ number }), shareOrderReceipt: async () => "shared", ...receiptOverrides },
    setMessage: (...args) => actions.push(["message", ...args]),
    showReceiptPreview: (...args) => actions.push(["preview", ...args]),
    completeOrder: id => actions.push(["complete", id]), confirmOrder: id => actions.push(["confirm", id]),
    cancelOrder: id => actions.push(["cancel", id]), showCancellationForm: id => actions.push(["form", id]),
    closeCancellationForm: button => actions.push(["close", button]),
    supabase: { rpc() { throw new Error("Printing must not call RPC"); } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function renderOrders()"), source.indexOf('productForm.addEventListener("submit"')), context);
  vm.runInContext(source.slice(source.indexOf('ordersList.addEventListener("click"'), source.indexOf('ordersList.addEventListener("change"')), context);
  vm.runInContext(source.slice(source.indexOf("function setOrderPrinting("), source.indexOf("function showReceiptPreview(")), context);
  vm.runInContext(source.slice(source.indexOf("async function printOrder("), source.indexOf("function showCancellationForm(")), context);
  const click = (selector, id) => listeners.click({ target: { closest: candidate => candidate === selector ? {
    dataset: { completeOrder: id, confirmOrder: id, cancelOrder: id, confirmCancellation: id },
    closest: () => ({ dataset: { orderId: id } })
  } : null } });
  return { context, buttons, actions, click };
}

for (const status of ["new", "confirmed", "completed", "cancelled", "future-status"]) {
  test(`card ${status} possui Imprimir e preserva ações permitidas`, () => {
    const { context } = harness([fixture({ status })]);
    context.renderOrders();
    const html = context.ordersList.innerHTML;
    assert.match(html, /data-order-actions/);
    assert.match(html, /type="button"\s+data-print-order="synthetic-id"/);
    assert.equal(html.includes("data-confirm-order="), status === "new");
    assert.equal(html.includes("data-complete-order="), status === "confirmed");
    assert.equal(html.includes("data-cancel-order="), !["completed", "cancelled"].includes(status));
  });
}

test("clique resolve o card correto e impressão não modifica os pedidos nem chama ações mutáveis", async () => {
  const orders = [fixture(), fixture({ id: "second-id", order_number: 272 })];
  const before = JSON.stringify(orders);
  const shared = [];
  const { click, actions, buttons } = harness(orders, { shareOrderReceipt: async file => { shared.push(file.number); return "shared"; } });
  await click("[data-print-order]", "second-id");
  assert.deepEqual(shared, [272]);
  assert.equal(JSON.stringify(orders), before);
  assert.deepEqual(actions, []);
  assert.equal(buttons.get("second-id").disabled, false);
});

test("bloqueia clique duplo, preserva estado após render e libera em cancelamento", async () => {
  let finish;
  let count = 0;
  const h = harness(undefined, { shareOrderReceipt: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
  const pending = h.context.printOrder("synthetic-id");
  await h.context.printOrder("synthetic-id");
  await new Promise(resolve => setImmediate(resolve));
  h.context.renderOrders();
  assert.match(h.context.ordersList.innerHTML, /aria-busy="true"\s+disabled/);
  assert.equal(count, 1);
  finish("cancelled");
  await pending;
  assert.equal(h.buttons.get("synthetic-id").disabled, false);
  assert.deepEqual(h.actions, []);
});

test("falhas liberam o botão, exibem mensagem segura e permitem nova tentativa", async () => {
  const h = harness(undefined, { canvasToPngFile: async () => { throw new Error("private detail"); } });
  await h.context.printOrder("synthetic-id");
  assert.equal(h.buttons.get("synthetic-id").disabled, false);
  assert.match(h.actions[0][2], /Tente novamente/);
  assert.doesNotMatch(JSON.stringify(h.actions), /private detail/);
  h.context.MimoOrderReceipt.canvasToPngFile = async () => ({});
  await h.context.printOrder("synthetic-id");
  assert.equal(h.context.printingOrderIds.size, 0);
});

test("delegação preserva confirmar, finalizar e os controles de cancelamento", async () => {
  const h = harness();
  for (const selector of ["data-confirm-order", "data-complete-order", "data-cancel-order", "data-confirm-cancellation", "data-close-cancellation"]) {
    await h.click(`[${selector}]`, "synthetic-id");
  }
  assert.deepEqual(h.actions.map(action => action[0]), ["confirm", "complete", "form", "cancel", "close"]);
  assert.match(source, /querySelector\("\[data-order-actions\]"\)\.hidden = true/);
  assert.match(source, /querySelector\("\[data-order-actions\]"\)\.hidden = false/);
});

test("dados preservam número, quantidade, produto, preço de linha e totais existentes", () => {
  const data = receipt.buildOrderReceiptData(fixture());
  assert.equal(data.orderNumber, 271);
  assert.deepEqual(data.items, [{ quantity: 3, productName: "Produto de teste", lineTotal: 39 }]);
  assert.equal(data.total, 39);
  assert.equal(data.subtotal, 39);
});

test("retirada, pagamento, logo ausente e comanda sem observação", () => {
  const canvas = render(fixture());
  const text = canvas.calls.map(call => call.value).join("\n");
  assert.equal(canvas.width, 384);
  for (const value of ["PEDIDO Nº 271", "RETIRADA", "Av. Frei Vicente, 485", "Aeroporto Velho", "Res. Gran Ville", "PIX"]) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /undefined|null|OBSERVAÇÃO|SEU PEDIDO|synthetic-id/);
});

test("entrega usa endereço e bairro existentes e taxa cobrada", () => {
  const canvas = render(fixture({ delivery_method: "Entrega", customer_address: "Rua fictícia, 123", delivery_neighborhood: "Bairro fictício", delivery_fee: 7, total: 46 }));
  const text = canvas.calls.map(call => call.value).join("\n");
  for (const value of ["ENTREGA", "Rua fictícia, 123", "Bairro fictício", money.format(7), money.format(46)]) assert.ok(text.includes(value.replace(/\u00a0/g, " ")), value);
});

test("muitos itens e textos longos aumentam altura sem perder conteúdo nem ultrapassar margens", () => {
  const notes = "Observação sintética longa ".repeat(50) + "z".repeat(100);
  const long = render(fixture({ notes, customer_name: "Cliente sintético ".repeat(10), order_items: Array.from({ length: 30 }, () => ({ quantity: 2, product_name: "Produto longo sintético ".repeat(8), line_total: 13 })) }));
  assert.ok(long.height > render(fixture()).height);
  const noteIndex = long.calls.findIndex(call => call.value === "OBSERVAÇÃO");
  const noteText = long.calls.slice(noteIndex + 1, -1).map(call => call.value).join("");
  assert.equal(noteText.replace(/\s/g, ""), notes.replace(/\s/g, ""));
  for (const call of long.calls) {
    assert.ok(call.y + parseInt(call.font.match(/(\d+)px/)[1]) <= long.height - 22);
    const width = call.value.length * parseInt(call.font.match(/(\d+)px/)[1]) * 0.55;
    const left = call.align === "right" ? call.x - width : call.align === "center" ? call.x - width / 2 : call.x;
    assert.ok(left >= 22);
    assert.ok(left + width <= 362);
  }
});

test("logo enviada é monocromática, proporcional e centralizada somente no topo", () => {
  const canvas = render(fixture(), { naturalWidth: 1255, naturalHeight: 820 });
  assert.equal(canvas.height - render(fixture()).height, 170);
  assert.equal(canvas.images.length, 1);
  const logo = canvas.images[0];
  assert.equal(logo.image.width, 260);
  assert.equal(logo.image.height, 170);
  assert.equal(logo.x, 62);
  assert.equal(logo.y, 22);
  assert.ok(logo.y + logo.image.height < canvas.calls[0].y);
  assert.equal(canvas.calls.at(-1).value, "Obrigada por pedir Mimo!");
});

test("PNG usa order_number no nome e não UUID; falha de conversão é detectada", async () => {
  const file = await receipt.canvasToPngFile(canvasFactory(), 271);
  assert.equal(file.name, "mimo-pedido-271.png");
  assert.equal(file.type, "image/png");
  await assert.rejects(receipt.canvasToPngFile({ toBlob: callback => callback(null) }, 271));
});

test("margens de 22 px protegem preços, subtotal, entrega e total dentro de 340 px", () => {
  for (const total of [46, 123456789.99]) {
    const canvas = render(fixture({ delivery_method: "Entrega", delivery_fee: 7, total }));
    assert.equal(canvas.width, 384);
    const amounts = canvas.calls.filter(call => call.align === "right");
    assert.ok(amounts.length >= 4);
    for (const call of amounts) {
      const width = call.value.length * parseInt(call.font.match(/(\d+)px/)[1]) * 0.55;
      assert.equal(call.x, 362);
      assert.ok(call.x - width >= 22);
    }
    const separators = canvas.rectangles.filter(rect => rect.height === 2);
    assert.ok(separators.length > 0);
    for (const rect of separators) {
      assert.equal(rect.x, 22);
      assert.equal(rect.width, 340);
    }
  }
});

test("emojis são removidos apenas da impressão, preservando acentos, números e pedido original", () => {
  const order = fixture({
    customer_name: "Cliente fictício 🍪",
    payment_method: "PIX ✅",
    delivery_method: "Entrega",
    customer_address: "Rua fictícia, 123 🏠",
    notes: "Observação ❤️ 👩🏽‍🍳 🇧🇷 1️⃣ às 18:00 ©️",
    order_items: [{ quantity: 2, product_name: "Cookie 🍪", line_total: 39 }]
  });
  const before = JSON.stringify(order);
  const text = render(order).calls.map(call => call.value).join("\n");
  assert.doesNotMatch(text, /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/u);
  for (const value of ["Cliente fictício", "Rua fictícia, 123", "2x Cookie", "Observação", "às 18:00", "Obrigada por pedir Mimo!"]) assert.ok(text.includes(value));
  assert.equal(JSON.stringify(order), before);
});

test("asset é uma cópia exata da imagem enviada e o carregamento usa somente essa logo", async () => {
  const asset = fs.readFileSync(require.resolve("../assets/images/receipt-logo.jpg"));
  assert.equal(require("node:crypto").createHash("sha256").update(asset).digest("hex"),
    "2297af82e4855fcb397fad8b59a1afe9c60e76b8ab95727941b2af0248f51dac");
  const paths = [];
  const context = { module: { exports: {} }, setTimeout, clearTimeout,
    Image: class {
      naturalWidth = 1255;
      naturalHeight = 820;
      set src(value) { paths.push(value); this.onload(); }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../admin/order-receipt.js"), "utf8"), context);
  const logo = await context.module.exports.loadReceiptLogo();
  assert.equal(await context.module.exports.loadReceiptLogo(), logo);
  assert.equal(logo.naturalWidth, 1255);
  assert.deepEqual(paths, ["../assets/images/receipt-logo.jpg"]);
});

test("share compatível envia o File PNG", async () => {
  const file = await receipt.canvasToPngFile(canvasFactory(), 271);
  let shared;
  const result = await receipt.shareOrderReceipt(file, { canShare: data => data.files[0] === file, share: async data => { shared = data; } });
  assert.equal(result, "shared");
  assert.deepEqual(shared.files, [file]);
});

test("AbortError cancela normalmente; falta de ativação oferece novo toque; erro real é seguro", async () => {
  for (const [name, expected] of [["AbortError", "cancelled"], ["NotAllowedError", "retry"]]) {
    assert.equal(await receipt.shareOrderReceipt({}, { canShare: () => true, share: async () => { throw { name }; } }), expected);
  }
  await assert.rejects(receipt.shareOrderReceipt({}, { canShare: () => true, share: async () => { throw new Error("private detail"); } }), { message: "Não foi possível compartilhar a comanda." });
});

test("ausência de file share e restrições usam prévia", async () => {
  for (const nav of [{}, { share() {}, canShare: () => false }, { share() {}, canShare() { throw new Error(); } }]) {
    assert.equal(await receipt.shareOrderReceipt({}, nav), "fallback");
  }
  for (const result of ["fallback", "retry"]) {
    const h = harness(undefined, { shareOrderReceipt: async () => result });
    await h.context.printOrder("synthetic-id");
    assert.equal(h.actions[0][0], "preview");
    assert.equal(h.buttons.get("synthetic-id").disabled, false);
  }
});

test("carregamento malsucedido da logo é tolerado, sem dados pessoais no warning", async () => {
  const warnings = [];
  const context = { module: { exports: {} }, setTimeout, clearTimeout,
    console: { warn: message => warnings.push(message) },
    Image: class { set src(value) { assert.equal(value, "../assets/images/receipt-logo.jpg"); this.onerror(); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../admin/order-receipt.js"), "utf8"), context);
  assert.equal(await context.module.exports.loadReceiptLogo(), null);
  assert.deepEqual(warnings, ["Logo da comanda indisponível."]);
});

test("prévia permite abrir/salvar e compartilhar com novo toque, liberando URLs ao fechar", async () => {
  const elements = Object.fromEntries(["img", "[data-receipt-open]", "[data-receipt-save]", "[data-receipt-share]", "[data-receipt-status]", "[data-receipt-close]"].map(key => [key, {
    removeAttribute(name) { delete this[name]; }
  }]));
  const listeners = new Set();
  const dialog = {
    open: false, querySelector: selector => elements[selector],
    addEventListener: (_, callback) => listeners.add(callback),
    removeEventListener: (_, callback) => listeners.delete(callback),
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  const revoked = [];
  const shared = [];
  const context = {
    document: { querySelector: () => dialog }, clearReceiptPreview() {},
    URL: { createObjectURL: file => `blob:${file.name}`, revokeObjectURL: url => revoked.push(url) },
    MimoOrderReceipt: { canShareReceipt: () => true, shareOrderReceipt: async file => { shared.push(file); return "cancelled"; } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function showReceiptPreview("), source.indexOf("async function printOrder(")), context);
  const file = { name: "mimo-pedido-271.png" };
  context.showReceiptPreview(file, "Pronta");
  assert.equal(dialog.open, true);
  assert.equal(elements["[data-receipt-save]"].download, file.name);
  assert.equal(elements["[data-receipt-open]"].href, `blob:${file.name}`);
  const pending = elements["[data-receipt-share]"].onclick();
  assert.deepEqual(shared, [file]); // Called synchronously in the user gesture.
  assert.equal(elements["[data-receipt-share]"].disabled, true);
  await pending;
  assert.equal(elements["[data-receipt-share]"].disabled, false);
  assert.match(elements["[data-receipt-status]"].textContent, /cancelado/);
  // A second finished preparation may replace a preview before the queued close event.
  const second = { name: "mimo-pedido-272.png" };
  context.showReceiptPreview(second, "Pronta");
  for (const callback of listeners) callback();
  assert.equal(elements.img.src, `blob:${second.name}`);
  elements["[data-receipt-close]"].onclick();
  for (const callback of listeners) callback();
  assert.equal(elements.img.src, undefined);
  assert.equal(elements["[data-receipt-share]"].onclick, null);
  assert.deepEqual(revoked, [`blob:${file.name}`, `blob:${second.name}`]);
});
