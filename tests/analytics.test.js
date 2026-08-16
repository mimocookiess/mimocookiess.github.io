const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const analyticsSource = fs.readFileSync(
  path.join(__dirname, "..", "analytics.js"),
  "utf8"
);
const configSource = fs.readFileSync(
  path.join(__dirname, "..", "config.js"),
  "utf8"
);

function loadAnalytics(measurementId = "G-TEST123") {
  const appendedScripts = [];
  const timers = [];
  const window = {
    document: {
      createElement: () => ({}),
      head: {
        append: script => appendedScripts.push(script)
      },
      querySelector: () => null
    },
    setTimeout: callback => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout: () => {}
  };
  const context = vm.createContext({
    Date,
    Promise,
    STORE_CONFIG: { gaMeasurementId: measurementId },
    URLSearchParams,
    console,
    encodeURIComponent,
    globalThis: window,
    window
  });

  vm.runInContext(analyticsSource, context);

  return { appendedScripts, timers, window };
}

function getQueuedCommands(window) {
  return (window.dataLayer || []).map(command => Array.from(command));
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("configura o Measurement ID real da Mimo Cookies", () => {
  const context = vm.createContext({});

  vm.runInContext(`${configSource}; globalThis.result = STORE_CONFIG;`, context);

  assert.equal(context.result.gaMeasurementId, "G-QYSQ9P1YRS");
});

test("Google tag usa config para um page_view automático sem envio manual", () => {
  const { appendedScripts, window } = loadAnalytics();
  const commands = getQueuedCommands(window);
  const configCommands = commands.filter(command => command[0] === "config");

  assert.equal(appendedScripts.length, 1);
  assert.equal(appendedScripts[0].id, "mimo-google-tag");
  assert.equal(
    appendedScripts[0].src,
    "https://www.googletagmanager.com/gtag/js?id=G-TEST123"
  );
  assert.equal(configCommands.length, 1);
  assert.equal(configCommands[0][1], "G-TEST123");
  assert.deepEqual(toPlain(configCommands[0][2]), {
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });
  assert.equal(
    commands.filter(command =>
      command[0] === "event" && command[1] === "page_view"
    ).length,
    0
  );
});

test("add_to_cart e remove_from_cart enviam apenas a quantidade alterada", () => {
  const { window } = loadAnalytics();
  const product = {
    id: "tradicional",
    name: "Tradicional",
    price: 10,
    databaseId: "uuid-interno",
    stock: 5
  };

  window.MimoAnalytics.trackAddToCart(product, 1);
  window.MimoAnalytics.trackRemoveFromCart(product, 1);

  const events = getQueuedCommands(window)
    .filter(command => command[0] === "event");

  assert.deepEqual(toPlain(events.map(event => event[1])), [
    "add_to_cart",
    "remove_from_cart"
  ]);
  events.forEach(([, , payload]) => {
    assert.equal(payload.currency, "BRL");
    assert.equal(payload.value, 10);
    assert.deepEqual(toPlain(payload.items), [{
      item_id: "tradicional",
      item_name: "Tradicional",
      price: 10,
      quantity: 1
    }]);
    assert.equal(Object.hasOwn(payload.items[0], "databaseId"), false);
    assert.equal(Object.hasOwn(payload.items[0], "stock"), false);
  });
});

test("view_cart, begin_checkout e order_created usam allowlist sem PII", () => {
  const { window } = loadAnalytics();
  const lines = [{
    product: {
      id: "biscoff",
      name: "Biscoff",
      price: "16.00",
      customer_name: "NÃO ENVIAR",
      notes: "NÃO ENVIAR"
    },
    quantity: 2,
    customer_address: "NÃO ENVIAR"
  }];

  window.MimoAnalytics.trackViewCart(lines);
  window.MimoAnalytics.trackBeginCheckout(lines);
  window.MimoAnalytics.trackOrderCreated({
    orderNumber: 78,
    subtotal: "32.00",
    lines,
    checkout_attempt_id: "NÃO ENVIAR"
  });

  const events = getQueuedCommands(window)
    .filter(command => command[0] === "event");
  const serializedEvents = JSON.stringify(events);
  const orderCreated = events.find(event => event[1] === "order_created");

  assert.deepEqual(toPlain(events.map(event => event[1])), [
    "view_cart",
    "begin_checkout",
    "order_created"
  ]);
  assert.equal(orderCreated[2].order_id, "MIMO-78");
  assert.equal(orderCreated[2].value, 32);
  assert.equal(serializedEvents.includes("customer_name"), false);
  assert.equal(serializedEvents.includes("customer_address"), false);
  assert.equal(serializedEvents.includes("notes"), false);
  assert.equal(serializedEvents.includes("checkout_attempt_id"), false);
  assert.equal(serializedEvents.includes("NÃO ENVIAR"), false);
});

test("identificadores GA4 são obtidos pela tag e valores inválidos viram null", async () => {
  const { window } = loadAnalytics();

  window.gtag = (command, target, fieldName, callback) => {
    assert.equal(command, "get");
    assert.equal(target, "G-TEST123");
    callback(fieldName === "client_id" ? "123.456" : "1700000000");
  };

  assert.deepEqual(
    toPlain(await window.MimoAnalytics.getIdentifiers()),
    { client_id: "123.456", session_id: "1700000000" }
  );

  const secondLoad = loadAnalytics();
  secondLoad.window.gtag = (command, target, fieldName, callback) => {
    callback(fieldName === "client_id" ? "nome com espaço" : "sessão");
  };

  assert.deepEqual(
    toPlain(await secondLoad.window.MimoAnalytics.getIdentifiers()),
    { client_id: null, session_id: null }
  );
});

test("GA4 ausente não carrega tag, não envia evento e não quebra checkout", async () => {
  const { appendedScripts, window } = loadAnalytics("");

  assert.equal(appendedScripts.length, 0);
  assert.equal(
    window.MimoAnalytics.trackAddToCart({
      id: "tradicional",
      name: "Tradicional",
      price: 10
    }, 1),
    false
  );
  assert.deepEqual(
    toPlain(await window.MimoAnalytics.getIdentifiers()),
    { client_id: null, session_id: null }
  );
});

test("GA4 bloqueado mantém identificadores nulos sem lançar erro", async () => {
  const { appendedScripts, timers, window } = loadAnalytics();
  const identifiersPromise = window.MimoAnalytics.getIdentifiers({
    timeoutMs: 1
  });

  assert.equal(appendedScripts.length, 1);
  timers.slice(1).forEach(callback => callback());

  assert.deepEqual(
    toPlain(await identifiersPromise),
    { client_id: null, session_id: null }
  );
});
