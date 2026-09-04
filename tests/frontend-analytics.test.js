const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const MimoStoreStatus = require("../store-status.js");

const scriptSource = fs.readFileSync(
  path.join(__dirname, "..", "script.js"),
  "utf8"
);
const indexSource = fs.readFileSync(
  path.join(__dirname, "..", "index.html"),
  "utf8"
);
const styleSource = fs.readFileSync(
  path.join(__dirname, "..", "style.css"),
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
    this.focused = false;
    this.layoutHeight = 0;
    this.innerHTML = "";
    this.textContent = "";
    this.required = false;
    const styleProperties = new Map();
    this.style = {
      properties: styleProperties,
      removeProperty(name) { styleProperties.delete(name); },
      setProperty(name, value) { styleProperties.set(name, value); }
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
  focus() { this.focused = true; }
  getBoundingClientRect() {
    return { bottom: this.layoutHeight, height: this.layoutHeight, top: 0 };
  }
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
    "store-pause-compact-message",
    "store-pause-close",
    "store-pause-announcement",
    "cart-pause-notice",
    "cart-pause-title",
    "cart-pause-message"
  ].map(id => [id, new FakeElement({ id })]));
  elements["customer-address"].value = "Rua de teste, 123";
  elements["cart-fab"].layoutHeight = 72;
  elements["delivery-neighborhood-options"].hidden = true;
  const brand = new FakeElement();
  const delivery = new FakeElement({ name: "delivery", value: "Entrega" });
  const payment = new FakeElement({ name: "payment", value: "Pix" });
  const analyticsCalls = [];
  const invokeBodies = [];
  const openedUrls = [];
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
  const documentElement = new FakeElement();
  const document = {
    body,
    documentElement,
    createElement: () => new FakeElement(),
    head: { append() {} },
    addEventListener() {},
    querySelector(selector) {
      if (selector === ".brand") return brand;
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
    MimoStoreStatus,
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
    open(url) {
      openedUrls.push(url);
      sequence.push("whatsapp");
    },
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
    openedUrls,
    sequence,
    brand,
    documentElement,
    setInvoke(nextInvoke) { invokeImplementation = nextInvoke; }
  };
}

function buildWhatsAppTestMessage(context, overrides = {}) {
  const options = {
    orderNumber: 9990,
    customerName: "Cliente de teste",
    items: ["1x Tradicional — R$ 10,00"],
    payment: "Pix",
    delivery: "Entrega",
    address: "Endereço de teste",
    neighborhood: "Bairro de teste",
    notes: "Observação de teste",
    subtotal: 10,
    deliveryFee: 12,
    total: 22,
    ...overrides
  };

  return vm.runInContext(
    `buildWhatsAppMessage(${JSON.stringify(options)})`,
    context
  );
}

function createIPhoneUserAgent(browser) {
  return "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
    `AppleWebKit/605.1.15 ${browser} Mobile/15E148 Safari/604.1`;
}

test("aviso público fica dentro do hero e fora do fluxo em todos os breakpoints", () => {
  const heroStart = indexSource.indexOf('<header class="hero"');
  const noticePosition = indexSource.indexOf('id="store-pause-banner"');
  const heroEnd = indexSource.indexOf("</header>", heroStart);
  const tabletStyles = styleSource.slice(
    styleSource.indexOf("@media (max-width: 960px)"),
    styleSource.indexOf("@media (max-width: 620px)")
  );
  const landscapeStyles = styleSource.slice(
    styleSource.indexOf("@media (min-width: 621px)"),
    styleSource.indexOf("@media (max-width: 620px)")
  );

  assert.ok(heroStart >= 0 && noticePosition > heroStart && noticePosition < heroEnd);
  assert.match(
    styleSource,
    /\.store-pause-card\s*\{[^}]*position:\s*absolute;/s
  );
  assert.match(
    tabletStyles,
    /\.store-pause-card\s*\{[^}]*position:\s*fixed;/s
  );
  assert.match(tabletStyles, /\.store-pause-card\s*\{[^}]*max-height:\s*calc\(/s);
  assert.match(
    tabletStyles,
    /\.store-pause-card\s*\{[^}]*max-height:[^}]*--cart-confirmation-height/s
  );
  assert.match(tabletStyles, /\.cart-confirmation\s*\{[^}]*top:\s*calc\(/s);
  assert.match(tabletStyles, /\.cart-confirmation\s*\{[^}]*bottom:\s*auto;/s);
  assert.match(styleSource, /--floating-control-bottom:[^;]*safe-area-inset-bottom/);
  assert.match(
    tabletStyles,
    /\.store-pause-card\s*\{[^}]*bottom:[^}]*--store-pause-fab-gap/s
  );
  assert.match(
    landscapeStyles,
    /\.store-pause-card\s*\{[^}]*top:\s*calc\([^}]*bottom:\s*auto;/s
  );
  assert.match(
    landscapeStyles,
    /\.store-pause-card\s*\{[^}]*left:\s*calc\(50% - 16px\);[^}]*width:\s*min\(480px,\s*calc\(100vw - 344px\)\);/s
  );
  assert.match(
    landscapeStyles,
    /\.store-pause-card\s*\{[^}]*gap:\s*8px;[^}]*padding:\s*8px 8px 8px 14px;/s
  );
  assert.match(
    landscapeStyles,
    /\.store-pause-status\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/s
  );
  assert.match(
    landscapeStyles,
    /\.store-pause-status h2\s*\{[^}]*font-size:\s*16px;/s
  );
  assert.match(
    landscapeStyles,
    /\.store-pause-close\s*\{[^}]*align-self:\s*start;/s
  );
  assert.match(styleSource, /\.store-pause-status\s*\{[^}]*min-height:\s*0;/s);
  assert.match(
    styleSource,
    /\.store-pause-details\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s
  );
  assert.match(
    tabletStyles,
    /\[data-store-state="paused"\][^}]*#store-pause-message\s*\{[^}]*display:\s*none;/s
  );
  assert.match(
    tabletStyles,
    /\.store-pause-compact-message:not\(\[hidden\]\)\s*\{[^}]*display:\s*block;[^}]*font-weight:\s*400;/s
  );
});

test("card de status preserva OPEN, PAUSED e CLOSED_TODAY e permite dispensa visual", async () => {
  const { brand, context, documentElement, elements } = await createHarness();
  const announcementWrites = [];
  let announcementText = elements["store-pause-announcement"].textContent;

  Object.defineProperty(elements["store-pause-announcement"], "textContent", {
    configurable: true,
    get: () => announcementText,
    set: value => {
      announcementText = value;
      announcementWrites.push({
        cardHidden: elements["store-pause-banner"].hidden,
        value
      });
    }
  });

  vm.runInContext(`
    storeSettings = {
      isPaused: true,
      mode: MimoStoreStatus.STORE_MODES.PAUSED,
      returnTime: null,
      pauseMessage: "Voltamos em breve."
    };
    renderStoreSettings();
  `, context);

  assert.equal(elements["store-pause-banner"].hidden, false);
  assert.equal(elements["store-pause-title"].textContent, "🍪 Pausa rapidinha!");
  assert.equal(elements["store-pause-message"].textContent, "Voltamos em breve.");
  assert.equal(elements["store-pause-compact-message"].textContent, "Voltamos logo.");
  assert.equal(elements["store-pause-compact-message"].hidden, false);
  assert.equal(
    elements["store-pause-banner"].attributes.get("data-store-state"),
    MimoStoreStatus.STORE_MODES.PAUSED
  );
  assert.equal(elements["cart-pause-notice"].hidden, false);
  assert.match(elements["cart-pause-message"].textContent, /Voltamos em breve\./);
  assert.equal(documentElement.style.properties.get("--cart-fab-height"), "72px");
  assert.ok(
    announcementWrites
      .filter(write => write.value)
      .every(write => write.cardHidden === false)
  );

  vm.runInContext(`
    storeSettings.returnTime = "2099-09-04T14:00:00.000Z";
    renderStoreSettings();
  `, context);

  const formattedReturnTime = vm.runInContext(
    "getPauseDetails().formattedReturnTime",
    context
  );
  assert.equal(
    elements["store-pause-compact-message"].textContent,
    `Voltamos ${formattedReturnTime}.`
  );
  assert.match(
    elements["store-pause-return"].textContent,
    /^Retorno previsto:/
  );
  assert.equal(elements["store-pause-message"].textContent, "Voltamos em breve.");

  const announcedValues = announcementWrites.filter(write => write.value);
  vm.runInContext("renderStoreSettings();", context);
  assert.equal(
    announcementWrites.filter(write => write.value).length,
    announcedValues.length
  );

  elements["cart-fab"].layoutHeight = 96;
  vm.runInContext(`
    cartConfirmation.layoutHeight = 52;
    syncFloatingControlHeights();
  `, context);
  assert.equal(documentElement.style.properties.get("--cart-fab-height"), "96px");
  assert.equal(
    documentElement.style.properties.get("--cart-confirmation-height"),
    "52px"
  );

  await elements["store-pause-close"].dispatch("click", { detail: 0 });

  assert.equal(elements["store-pause-banner"].hidden, true);
  assert.equal(elements["cart-pause-notice"].hidden, false);
  assert.equal(brand.focused, true);
  assert.equal(elements["store-pause-announcement"].textContent, "");
  assert.equal(
    vm.runInContext("getStoreState()", context),
    MimoStoreStatus.STORE_MODES.PAUSED
  );

  vm.runInContext("renderStoreSettings();", context);
  assert.equal(elements["store-pause-banner"].hidden, true);

  vm.runInContext(`
    storeSettings = {
      isPaused: true,
      mode: MimoStoreStatus.STORE_MODES.CLOSED_TODAY,
      returnTime: "2099-09-04T14:00:00.000Z",
      pauseMessage: ""
    };
    storePauseDismissed = false;
    renderStoreSettings();
  `, context);

  assert.equal(elements["store-pause-banner"].hidden, false);
  assert.equal(elements["store-pause-title"].textContent, "🍪 Por hoje, encerramos!");
  assert.equal(elements["store-pause-return"].hidden, true);
  assert.equal(
    elements["store-pause-message"].textContent,
    vm.runInContext("getClosedDetails().returnText", context)
  );
  assert.equal(elements["store-pause-message"].hidden, false);
  assert.equal(elements["store-pause-compact-message"].hidden, true);
  assert.equal(elements["cart-pause-notice"].hidden, false);

  vm.runInContext(`
    storeSettings = {
      isPaused: false,
      mode: MimoStoreStatus.STORE_MODES.OPEN,
      returnTime: null,
      pauseMessage: ""
    };
    renderStoreSettings();
  `, context);

  assert.equal(elements["store-pause-banner"].hidden, true);
  assert.equal(elements["cart-pause-notice"].hidden, true);
  assert.equal(
    vm.runInContext("getStoreState()", context),
    MimoStoreStatus.STORE_MODES.OPEN
  );
});

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

test("emojis do WhatsApp têm code points válidos", async () => {
  const { context } = await createHarness();
  const codePoints = vm.runInContext(`Object.fromEntries(
    Object.entries(WHATSAPP_EMOJIS).map(([name, emoji]) => [
      name,
      Array.from(emoji, character => character.codePointAt(0))
    ])
  )`, context);

  assert.deepEqual(JSON.parse(JSON.stringify(codePoints)), {
    cookie: [0x1F36A],
    heart: [0x1F497],
    customer: [0x1F464],
    cart: [0x1F6D2],
    payment: [0x1F4B3],
    location: [0x1F4CD],
    pin: [0x1F4CC],
    home: [0x1F3E0],
    delivery: [0x1F6F5],
    notes: [0x1F4DD]
  });
});

test("mensagem normal inclui ou remove todos os emojis configurados", async () => {
  const { context } = await createHarness();
  const withEmojis = buildWhatsAppTestMessage(context, {
    includeEmojis: true
  });
  const withoutEmojis = buildWhatsAppTestMessage(context, {
    includeEmojis: false
  });

  for (const emoji of ["🍪", "💗", "👤", "🛒", "💳", "🛵", "🏠", "📌", "📝"]) {
    assert.ok(withEmojis.includes(emoji));
    assert.ok(!withoutEmojis.includes(emoji));
  }
  assert.doesNotMatch(withoutEmojis, /[\u{1F300}-\u{1FAFF}]/u);
});

test("WhatsApp inclui aviso da pausa com horário antes dos valores", async () => {
  const { context } = await createHarness();
  const message = vm.runInContext(`buildWhatsAppMessage({
    orderNumber: 92,
    customerName: "Cliente",
    items: ["1x Tradicional — R$ 10,00"],
    payment: "Pix",
    delivery: "Entrega",
    address: "Rua X, 123",
    neighborhood: "Mapiri",
    notes: "",
    subtotal: 10,
    deliveryFee: 12,
    total: 22,
    isTemporarilyPaused: true,
    pauseReturnTime: "15h30"
  })`, context);

  const receivingBlock = "🛵 *ENTREGA*\n" +
    "🏠 *Endereço:* Rua X, 123\n" +
    "📌 *Bairro:* Mapiri";
  const pauseBlock = "🍪 *Estamos em uma pausa rapidinha.*\n" +
    "Voltamos às 15h30 e seu pedido será confirmado assim que retornarmos.";

  assert.match(message, new RegExp(
    `${receivingBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\n` +
    `${pauseBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\n` +
    "\\*Subtotal:\\*"
  ));
  assert.match(message, /\*Frete:\* R\$\s12,00/);
  assert.match(message, /\*Total:\* R\$\s22,00/);
});

test("horário de retorno do WhatsApp usa formato natural da loja", async () => {
  const { context } = await createHarness();

  assert.equal(
    vm.runInContext('formatLocalHour(new Date("2026-09-02T18:30:00Z"))', context),
    "15h30"
  );
  assert.equal(
    vm.runInContext('formatLocalHour(new Date("2026-09-02T19:00:00Z"))', context),
    "16h"
  );
  assert.equal(
    vm.runInContext('formatLocalHour(new Date("2026-09-02T12:05:00Z"))', context),
    "9h05"
  );
});

test("WhatsApp inclui aviso da pausa sem horário na retirada", async () => {
  const { context } = await createHarness();
  const message = vm.runInContext(`buildWhatsAppMessage({
    orderNumber: 93,
    customerName: "Cliente",
    items: ["1x Tradicional — R$ 10,00"],
    payment: "Pix",
    delivery: "Retirada",
    address: "",
    neighborhood: "",
    notes: "",
    subtotal: 10,
    deliveryFee: 0,
    total: 10,
    isTemporarilyPaused: true,
    pauseReturnTime: null
  })`, context);

  assert.match(message, /🍪 \*Estamos em uma pausa rapidinha\.\*\nSeu pedido será confirmado assim que voltarmos\./);
  assert.doesNotMatch(message, /Voltamos às|null|undefined/);
  assert.doesNotMatch(message, /\*Frete:\*/);
});

test("WhatsApp em pausa não contorna includeEmojis false", async () => {
  const { context } = await createHarness();
  const message = buildWhatsAppTestMessage(context, {
    delivery: "Retirada",
    address: "",
    neighborhood: "",
    deliveryFee: 0,
    total: 10,
    isTemporarilyPaused: true,
    pauseReturnTime: "15h30",
    includeEmojis: false
  });

  assert.match(message, /\*Estamos em uma pausa rapidinha\.\*/);
  assert.doesNotMatch(message, /[\u{1F300}-\u{1FAFF}]/u);
});

test("URL entregue ao WhatsApp preserva emojis e Unicode válido", async () => {
  const harness = await createHarness();
  const { context, elements, openedUrls } = harness;

  context.navigator.userAgent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 " +
    "Mobile/15E148 Safari/604.1";
  vm.runInContext('addItem("tradicional"); turnstileToken = "token";', context);
  elements["customer-name"].value = "Cliente de teste";
  await elements["checkout-form"].dispatch("submit");

  assert.equal(openedUrls.length, 1);
  assert.match(openedUrls[0], /^https:\/\/wa\.me\/5593000000000\?text=/);
  for (const encodedEmoji of [
    "%F0%9F%8D%AA",
    "%F0%9F%92%97",
    "%F0%9F%91%A4",
    "%F0%9F%9B%92",
    "%F0%9F%92%B3",
    "%F0%9F%9B%B5",
    "%F0%9F%8F%A0",
    "%F0%9F%93%8C"
  ]) {
    assert.ok(openedUrls[0].includes(encodedEmoji), encodedEmoji);
  }
  assert.doesNotMatch(openedUrls[0], /�|%EF%BF%BD/i);

  const message = new URL(openedUrls[0]).searchParams.get("text");
  assert.match(message, /Olá!.*🍪💗/u);
  assert.equal(message.isWellFormed(), true);
  assert.doesNotMatch(message, /�/);
});

test("detecção de emojis cobre browsers e webview móveis sem distingui-los", async () => {
  const { context } = await createHarness();
  const desktopSafariUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15";
  const cases = [
    ["iPhone Safari", createIPhoneUserAgent("Version/18.6"), 0, true],
    ["iPhone Chrome", createIPhoneUserAgent("CriOS/140.0"), 0, true],
    ["iPhone Firefox", createIPhoneUserAgent("FxiOS/142.0"), 0, true],
    [
      "Instagram webview",
      createIPhoneUserAgent("Instagram/395.0.0"),
      0,
      true
    ],
    [
      "Android Chrome",
      "Mozilla/5.0 (Linux; Android 15; Mobile) Chrome/140.0 Mobile",
      0,
      true
    ],
    ["desktop Safari", desktopSafariUserAgent, 0, false],
    ["iPadOS desktop UA", desktopSafariUserAgent, 5, true]
  ];

  for (const [name, userAgent, maxTouchPoints, expected] of cases) {
    context.navigator.userAgent = userAgent;
    context.navigator.maxTouchPoints = maxTouchPoints;
    delete context.navigator.userAgentData;
    assert.equal(vm.runInContext("shouldIncludeWhatsAppEmojis()", context), expected, name);
  }

  context.navigator.userAgent = createIPhoneUserAgent("Version/18.6");
  context.navigator.userAgentData = { mobile: false };
  assert.equal(vm.runInContext("shouldIncludeWhatsAppEmojis()", context), false);

  context.navigator.userAgent = desktopSafariUserAgent;
  context.navigator.userAgentData = { mobile: true };
  assert.equal(vm.runInContext("shouldIncludeWhatsAppEmojis()", context), true);
});

test("WhatsApp não inclui aviso quando a loja está aberta", async () => {
  const { context } = await createHarness();
  const message = vm.runInContext(`buildWhatsAppMessage({
    orderNumber: 94,
    customerName: "Cliente",
    items: ["1x Tradicional — R$ 10,00"],
    payment: "Pix",
    delivery: "Retirada",
    address: "",
    neighborhood: "",
    notes: "",
    subtotal: 10,
    deliveryFee: 0,
    total: 10,
    isTemporarilyPaused: false,
    pauseReturnTime: "15h30"
  })`, context);

  assert.doesNotMatch(message, /pausa rapidinha|Voltamos às/);
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
