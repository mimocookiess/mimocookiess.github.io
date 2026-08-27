const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const scriptSource = fs.readFileSync(
  path.join(__dirname, "..", "script.js"),
  "utf8"
);

class FakeElement {
  constructor({ id = "", name = "", value = "" } = {}) {
    this.id = id;
    this.name = name;
    this.value = value;
    this.listeners = new Map();
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = "";
    this.textContent = "";
    this.required = false;
    this.style = {
      removeProperty() {},
      setProperty() {}
    };
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      contains: name => classes.has(name),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !classes.has(name) : force;

        if (shouldAdd) classes.add(name);
        else classes.delete(name);

        return shouldAdd;
      }
    };
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  append() {}
  closest() { return null; }
  focus() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  removeAttribute() {}
  setAttribute(name, value) { this.attributes.set(name, value); }

  matches(selector) {
    return selector.includes(`#${this.id}`) ||
      (this.name && selector.includes(`name="${this.name}"`));
  }

  async dispatch(name, extra = {}) {
    const event = {
      target: this,
      preventDefault() {},
      ...extra
    };

    for (const listener of this.listeners.get(name) || []) {
      await listener(event);
    }
  }
}

async function createHarness({ invoke, productsData = [] } = {}) {
  const elements = Object.fromEntries([
    "product-grid",
    "cart-fab",
    "cart-fab-summary",
    "cart-panel",
    "overlay",
    "close-cart",
    "cart-items",
    "subtotal",
    "total",
    "shipping",
    "checkout-form",
    "address-fields",
    "customer-address",
    "delivery-neighborhood",
    "delivery-neighborhood-selected-indicator",
    "delivery-neighborhood-options",
    "delivery-neighborhood-message",
    "delivery-choice-fee",
    "customer-name",
    "customer-notes",
    "whatsapp-button",
    "turnstile-message",
    "store-pause-banner",
    "store-pause-title",
    "store-pause-return",
    "store-pause-message",
    "cart-pause-notice",
    "cart-pause-title",
    "cart-pause-message"
  ].map(id => [id, new FakeElement({ id })]));
  elements["customer-address"].value = "Rua de teste, 123";
  elements["delivery-neighborhood-options"].hidden = true;
  const delivery = new FakeElement({ name: "delivery", value: "Entrega" });
  const payment = new FakeElement({ name: "payment", value: "Pix" });
  const analyticsCalls = [];
  const invokeBodies = [];
  const sequence = [];
  let invokeImplementation = invoke || (async () => ({
    data: {
      id: "00000000-0000-4000-8000-000000000078",
      order_number: 78,
      subtotal: 10,
      delivery_fee: 12,
      total: 22,
      delivery_neighborhood: "Mapiri",
      payment_method: "Pix",
      payment_status: "pending"
    },
    error: null
  }));
  const body = new FakeElement();
  const document = {
    body,
    createElement: () => new FakeElement(),
    head: { append() {} },
    addEventListener() {},
    querySelector(selector) {
      if (selector === 'input[name="delivery"]:checked') return delivery;
      if (selector === 'input[name="payment"]:checked') return payment;
      return elements[selector.replace(/^#/, "")] || null;
    },
    querySelectorAll(selector) {
      return selector === 'input[name="delivery"]' ? [delivery] : [];
    }
  };
  const productsQuery = {
    select() { return this; },
    async order() { return { data: productsData, error: null }; }
  };
  const settingsQuery = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: null, error: null }; }
  };
  const context = vm.createContext({
    AbortController,
    Date,
    Intl,
    JSON,
    Map,
    Number,
    Promise,
    Set,
    String,
    Uint8Array,
    URL,
    console,
    crypto: webcrypto,
    document,
    navigator: { maxTouchPoints: 0, userAgent: "test" },
    alert() {},
    confirm: () => true,
    STORE_CONFIG: {
      whatsappNumber: "5593000000000",
      pickupAddress: "Endereço público da loja",
      turnstileSiteKey: "test",
      orderFunctionName: "create-order"
    },
    FALLBACK_PRODUCTS: [{
      id: "tradicional",
      name: "Tradicional",
      price: 10,
      image: "https://example.test/tradicional.webp",
      description: "Cookie",
      available: true,
      stock: 10
    }],
    MimoDeliveryZones: {
      filterDeliveryZones: (zones, query, limit) => zones
        .filter(zone => zone.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit)
    },
    MimoStoreStatus: {
      STORE_MODES: {
        OPEN: "open",
        PAUSED: "paused",
        CLOSED_TODAY: "closed_today"
      },
      STORE_TIME_ZONE: "America/Santarem",
      getStoreDateTimeParts: () => ({
        year: 2026,
        month: 8,
        day: 16,
        hour: 12,
        minute: 0
      }),
      getStoreState: settings => settings.mode,
      normalizeStoreMode: value => value || "open",
      toValidDate: () => null
    },
    supabaseClient: {
      from: table => table === "products" ? productsQuery : settingsQuery,
      async rpc(name) {
        assert.equal(name, "list_delivery_zones");
        return {
          data: [{ slug: "mapiri", name: "Mapiri", fee: 12 }],
          error: null
        };
      },
      functions: {
        async invoke(name, options) {
          invokeBodies.push(options.body);
          return invokeImplementation(name, options);
        }
      }
    }
  });
  const window = {
    MimoAnalytics: {
      getIdentifiers: async () => ({
        client_id: "123.456",
        session_id: "1700000000"
      }),
      trackAddToCart: (product, quantity) =>
        analyticsCalls.push(["add_to_cart", product.id, quantity]),
      trackRemoveFromCart: (product, quantity) =>
        analyticsCalls.push(["remove_from_cart", product.id, quantity]),
      trackViewCart: lines =>
        analyticsCalls.push(["view_cart", lines.map(line => line.quantity)]),
      trackBeginCheckout: lines =>
        analyticsCalls.push(["begin_checkout", lines.map(line => line.quantity)]),
      trackOrderCreated: payload => {
        analyticsCalls.push(["order_created", payload.orderNumber]);
        sequence.push("order_created");
      }
    },
    cancelAnimationFrame() {},
    clearInterval() {},
    clearTimeout() {},
    confirm: () => true,
    location: { href: "https://lojamimocookies.com.br/" },
    matchMedia: () => ({ matches: false }),
    open() { sequence.push("whatsapp"); },
    requestAnimationFrame: callback => {
      callback();
      return 1;
    },
    setTimeout: () => 1
  };

  Object.assign(context, { window });
  vm.runInContext(scriptSource, context);
  await new Promise(resolve => setImmediate(resolve));
  vm.runInContext("selectDeliveryZone(deliveryZones[0]);", context);

  return {
    analyticsCalls,
    context,
    elements,
    invokeBodies,
    sequence,
    setInvoke(nextInvoke) { invokeImplementation = nextInvoke; }
  };
}

test("catálogo separa visibilidade de disponibilidade por estoque", async () => {
  const createProduct = ({ slug, available, stock, displayOrder }) => ({
    id: `00000000-0000-4000-8000-${String(displayOrder).padStart(12, "0")}`,
    slug,
    name: slug,
    price: 10,
    description: `Produto ${slug}`,
    image_url: `https://example.test/${slug}.webp`,
    available,
    stock,
    display_order: displayOrder
  });
  const harness = await createHarness({
    productsData: [
      createProduct({
        slug: "visivel-com-estoque",
        available: true,
        stock: 5,
        displayOrder: 1
      }),
      createProduct({
        slug: "visivel-sem-estoque",
        available: true,
        stock: 0,
        displayOrder: 2
      }),
      createProduct({
        slug: "oculto-com-estoque",
        available: false,
        stock: 5,
        displayOrder: 3
      }),
      createProduct({
        slug: "oculto-sem-estoque",
        available: false,
        stock: 0,
        displayOrder: 4
      })
    ]
  });
  const catalogHtml = harness.elements["product-grid"].innerHTML;

  assert.match(catalogHtml, /visivel-com-estoque/);
  assert.match(catalogHtml, /visivel-sem-estoque/);
  assert.doesNotMatch(catalogHtml, /oculto-com-estoque/);
  assert.doesNotMatch(catalogHtml, /oculto-sem-estoque/);
  assert.match(
    catalogHtml,
    /visivel-sem-estoque[\s\S]*?status-sold-out[\s\S]*?disabled[\s\S]*?Indisponível/
  );

  vm.runInContext(`
    addItem("visivel-com-estoque");
    addItem("visivel-sem-estoque");
    addItem("oculto-com-estoque");
    addItem("oculto-sem-estoque");
  `, harness.context);

  assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify([...cart.entries()])", harness.context)),
    [["visivel-com-estoque", 1]]
  );
});

test("catálogo exibe novidade com cada status e prioriza sua ordenação", async () => {
  const createProduct = ({
    slug,
    available = true,
    stock = 5,
    displayOrder,
    isNew
  }) => ({
    id: `00000000-0000-4000-8000-${String(displayOrder).padStart(12, "0")}`,
    slug,
    name: slug,
    price: 10,
    description: `Produto ${slug}`,
    image_url: `https://example.test/${slug}.webp`,
    available,
    is_new: isNew,
    stock,
    display_order: displayOrder
  });
  const harness = await createHarness({
    productsData: [
      createProduct({ slug: "comum", displayOrder: 1, isNew: false }),
      createProduct({ slug: "nova-disponivel", displayOrder: 3, isNew: true }),
      createProduct({ slug: "nova-acabando", stock: 2, displayOrder: 4, isNew: true }),
      createProduct({ slug: "nova-esgotada", stock: 0, displayOrder: 5, isNew: true }),
      createProduct({
        slug: "nova-oculta",
        available: false,
        displayOrder: 2,
        isNew: true
      }),
      createProduct({ slug: "sem-campo", displayOrder: 6 })
    ]
  });
  const catalogHtml = harness.elements["product-grid"].innerHTML;

  assert.match(
    catalogHtml,
    /nova-disponivel[\s\S]*?status-available[\s\S]*?status-new[\s\S]*?NOVIDADE ✨/
  );
  assert.match(
    catalogHtml,
    /nova-acabando[\s\S]*?status-low-stock[\s\S]*?status-new/
  );
  assert.match(
    catalogHtml,
    /nova-esgotada[\s\S]*?status-sold-out[\s\S]*?status-new/
  );
  assert.doesNotMatch(catalogHtml, /nova-oculta/);

  assert.match(catalogHtml, /comum/);
  assert.match(catalogHtml, /sem-campo/);
  assert.equal((catalogHtml.match(/status-new/g) || []).length, 3);

  assert.ok(catalogHtml.indexOf("nova-disponivel") < catalogHtml.indexOf("comum"));
  assert.ok(catalogHtml.indexOf("nova-disponivel") < catalogHtml.indexOf("nova-acabando"));
  assert.ok(catalogHtml.indexOf("nova-acabando") < catalogHtml.indexOf("nova-esgotada"));

  const reordered = JSON.parse(vm.runInContext(`JSON.stringify(
    sortProductsForDisplay([
      { id: "primeiro", displayOrder: 1, is_new: false, stock: 5 },
      { id: "segundo", displayOrder: 2, is_new: true, stock: 5 }
    ]).map(product => product.id)
  )`, harness.context));
  const restored = JSON.parse(vm.runInContext(`JSON.stringify(
    sortProductsForDisplay([
      { id: "primeiro", displayOrder: 1, is_new: false, stock: 5 },
      { id: "segundo", displayOrder: 2, is_new: false, stock: 5 }
    ]).map(product => product.id)
  )`, harness.context));

  assert.deepEqual(reordered, ["segundo", "primeiro"]);
  assert.deepEqual(restored, ["primeiro", "segundo"]);
});

test("fluxo do carrinho emite deltas, uma visualização por abertura e um checkout", async () => {
  const harness = await createHarness();
  const { analyticsCalls, context, elements } = harness;

  vm.runInContext('addItem("tradicional"); changeQuantity("tradicional", 1);', context);
  vm.runInContext('changeQuantity("tradicional", -1);', context);
  vm.runInContext("openCart(); openCart();", context);
  await elements["checkout-form"].dispatch("focusin", {
    target: elements["customer-name"]
  });
  await elements["checkout-form"].dispatch("input", {
    target: elements["customer-name"]
  });

  assert.deepEqual(JSON.parse(JSON.stringify(analyticsCalls)), [
    ["add_to_cart", "tradicional", 1],
    ["add_to_cart", "tradicional", 1],
    ["remove_from_cart", "tradicional", 1],
    ["view_cart", [1]],
    ["begin_checkout", [1]]
  ]);

  vm.runInContext('changeQuantity("tradicional", -1);', context);
  assert.deepEqual(JSON.parse(JSON.stringify(analyticsCalls.at(-1))), [
    "remove_from_cart",
    "tradicional",
    1
  ]);
});

test("order_created ocorre uma vez após o backend e antes do WhatsApp", async () => {
  const harness = await createHarness();
  const { analyticsCalls, context, elements, invokeBodies, sequence } = harness;

  vm.runInContext('addItem("tradicional"); turnstileToken = "token";', context);
  elements["customer-name"].value = "Cliente de teste";
  await elements["checkout-form"].dispatch("submit");
  await elements["checkout-form"].dispatch("submit");

  assert.equal(invokeBodies.length, 1);
  assert.deepEqual(sequence, ["order_created", "whatsapp", "whatsapp"]);
  assert.equal(
    analyticsCalls.filter(call => call[0] === "order_created").length,
    1
  );
  assert.match(invokeBodies[0].checkout_attempt_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(JSON.stringify(invokeBodies[0].analytics)), {
    client_id: "123.456",
    session_id: "1700000000"
  });
  assert.equal(
    invokeBodies[0].order.p_delivery_neighborhood_slug,
    "mapiri"
  );
  assert.equal(Object.hasOwn(invokeBodies[0].order, "p_delivery_fee"), false);
});

test("WhatsApp usa bairro, frete e total retornados pelo backend", async () => {
  const { context } = await createHarness();
  const message = vm.runInContext(`buildWhatsAppMessage({
    orderNumber: 91,
    customerName: "Cliente",
    items: ["2x Tradicional — R$ 20,00"],
    payment: "Pix",
    delivery: "Entrega",
    address: "Rua X, 123",
    neighborhood: "Mapiri",
    notes: "",
    subtotal: 20,
    deliveryFee: 12,
    total: 32,
    includeEmojis: false
  })`, context);

  assert.match(message, /\*Endereço:\* Rua X, 123/);
  assert.match(message, /\*Bairro:\* Mapiri/);
  assert.match(message, /\*Subtotal:\* R\$\s20,00/);
  assert.match(message, /\*Frete:\* R\$\s12,00/);
  assert.match(message, /\*Total:\* R\$\s32,00/);
  assert.doesNotMatch(message, /a confirmar|\+ frete/i);
});

test("erro não emite order_created e retry reutiliza checkout_attempt_id", async () => {
  let callCount = 0;
  const harness = await createHarness({
    invoke: async () => {
      callCount += 1;
      if (callCount === 1) {
        return { data: null, error: new Error("falha simulada") };
      }

      return {
        data: {
          id: "00000000-0000-4000-8000-000000000078",
          order_number: 78,
          subtotal: 10,
          delivery_fee: 12,
          total: 22,
          delivery_neighborhood: "Mapiri",
          payment_method: "Pix",
          payment_status: "pending"
        },
        error: null
      };
    }
  });
  const { analyticsCalls, context, elements, invokeBodies } = harness;

  vm.runInContext('addItem("tradicional"); turnstileToken = "token";', context);
  elements["customer-name"].value = "Cliente de teste";
  await elements["checkout-form"].dispatch("submit");

  assert.equal(
    analyticsCalls.filter(call => call[0] === "order_created").length,
    0
  );

  vm.runInContext('turnstileToken = "token-2";', context);
  await elements["checkout-form"].dispatch("submit");

  assert.equal(invokeBodies.length, 2);
  assert.equal(
    invokeBodies[0].checkout_attempt_id,
    invokeBodies[1].checkout_attempt_id
  );
  assert.equal(
    analyticsCalls.filter(call => call[0] === "order_created").length,
    1
  );
});

test("analytics indisponível envia nulls e não impede o pedido", async () => {
  const harness = await createHarness();
  const { context, elements, invokeBodies, sequence } = harness;

  context.window.MimoAnalytics = undefined;
  vm.runInContext('addItem("tradicional"); turnstileToken = "token";', context);
  elements["customer-name"].value = "Cliente de teste";
  await elements["checkout-form"].dispatch("submit");

  assert.equal(invokeBodies.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(invokeBodies[0].analytics)), {
    client_id: null,
    session_id: null
  });
  assert.deepEqual(sequence, ["whatsapp"]);
});
