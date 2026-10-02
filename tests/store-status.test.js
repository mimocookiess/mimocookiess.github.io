const test = require("node:test");
const assert = require("node:assert/strict");
const status = require("../store-status.js");

const at = value => status.storeLocalDateTimeToDate(value);
const automatic = { isPaused: false, mode: "open", manualOpenUntil: null };

test("expediente abre às 11h e fecha às 19h de terça a domingo", () => {
  for (const day of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]) {
    assert.equal(status.getStoreState(automatic, at(`${day}T10:59`)), "closed_today");
    assert.equal(status.getStoreState(automatic, at(`${day}T11:00`)), "open");
    assert.equal(status.getStoreState(automatic, at(`${day}T18:59`)), "open");
    assert.equal(status.getStoreState(automatic, at(`${day}T19:00`)), "closed_today");
  }
});

test("segunda-feira permanece fechada e domingo retorna na terça", () => {
  assert.equal(status.getStoreState(automatic, at("2026-09-07T12:00")), "closed_today");
  assert.equal(
    status.toStoreLocalDateTimeInput(status.getNextRegularOpening(at("2026-09-06T19:00"))),
    "2026-09-08T11:00"
  );
});

test("abertura excepcional vale fora do expediente até meia-noite", () => {
  const settings = {
    ...automatic,
    manualOpenUntil: at("2026-09-08T00:00").toISOString()
  };
  assert.equal(status.getStoreState(settings, at("2026-09-07T12:00")), "open");
  assert.equal(status.getStoreState(settings, at("2026-09-07T23:59")), "open");
  assert.equal(status.getStoreState(settings, at("2026-09-08T00:00")), "closed_today");
  assert.equal(
    status.toStoreLocalDateTimeInput(status.getNextStoreMidnight(at("2026-09-07T12:00"))),
    "2026-09-08T00:00"
  );
});

test("open legado segue o expediente e não vira exceção", () => {
  assert.equal(status.normalizeStoreMode("open", false), "open");
  assert.equal(status.getStoreState({ isPaused: false, mode: "open" }, at("2026-09-01T20:00")), "closed_today");
});

test("pausa e fechamento manual prevalecem até o retorno e depois voltam ao expediente", () => {
  const returnTime = at("2026-09-01T20:00").toISOString();
  assert.equal(status.getStoreState({isPaused:true,mode:"paused",returnTime}, at("2026-09-01T12:00")), "paused");
  assert.equal(status.getStoreState({isPaused:true,mode:"paused",returnTime}, at("2026-09-01T20:00")), "closed_today");
  assert.equal(status.getStoreState({isPaused:true,mode:"closed_today",returnTime}, at("2026-09-01T12:00")), "closed_today");
  assert.equal(status.getStoreState({isPaused:true,mode:"closed_today",returnTime}, at("2026-09-02T12:00")), "open");
});

test("ações limpam estados conflitantes e persistem apenas a data da exceção", () => {
  const now = at("2026-09-01T19:30");
  assert.deepEqual(status.buildStoreSettingsUpdate("manual_open", null, " Mensagem ", now), {
    is_paused: false,
    store_mode: "open",
    return_time: null,
    pause_message: "Mensagem",
    manual_open_until: at("2026-09-02T00:00").toISOString()
  });
  assert.equal(status.buildStoreSettingsUpdate("automatic", null, "", now).manual_open_until, null);
  assert.equal(status.buildStoreSettingsUpdate("paused", null, "", now).manual_open_until, null);
});

test("datas da loja não dependem do fuso do dispositivo", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Asia/Tokyo", "America/Los_Angeles", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(at("2026-09-01T11:00").toISOString(), "2026-09-01T14:00:00.000Z");
      assert.equal(status.getStoreState(automatic, at("2026-09-01T11:00")), "open");
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("timer e retorno de aba suspensa reavaliam e sincronizam", async () => {
  const listeners = {}, timers = [], calls = [];
  const window = {
    clearTimeout() {},
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    addEventListener(name, fn) { listeners[name] = fn; }
  };
  const document = { hidden: false, addEventListener(name, fn) { listeners[name] = fn; } };
  status.watchStoreStatus({ window, document, getSettings: () => automatic,
    render: () => calls.push("render"), refresh: async () => calls.push("refresh") });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["render", "refresh"]);
  calls.length = 0;
  await listeners.focus();
  listeners.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["render", "refresh", "render", "refresh"]);
  assert.ok(timers.every(timer => timer.delay <= 60000));
});
