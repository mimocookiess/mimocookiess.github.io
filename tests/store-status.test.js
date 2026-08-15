const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STORE_MODES,
  buildStoreSettingsUpdate,
  getStoreState,
  getTomorrowAtTen,
  storeLocalDateTimeToDate,
  toValidDate,
  toStoreLocalDateTimeInput
} = require("../store-status.js");

const returnAtTen = "2026-08-06T13:00:00.000Z";

test("pausa temporária continua pausa mesmo com retorno no dia seguinte", () => {
  const state = getStoreState({
    isPaused: true,
    mode: STORE_MODES.PAUSED,
    returnTime: returnAtTen
  }, new Date("2026-08-06T00:00:00.000Z"));

  assert.equal(state, STORE_MODES.PAUSED);
});

test("fechado por hoje permanece fechado durante a noite", () => {
  const state = getStoreState({
    isPaused: true,
    mode: STORE_MODES.CLOSED_TODAY,
    returnTime: returnAtTen
  }, new Date("2026-08-06T03:30:00.000Z"));

  assert.equal(state, STORE_MODES.CLOSED_TODAY);
});

test("fechado por hoje permanece fechado às 7h50 da manhã seguinte", () => {
  const state = getStoreState({
    isPaused: true,
    mode: STORE_MODES.CLOSED_TODAY,
    returnTime: returnAtTen
  }, new Date("2026-08-06T10:50:00.000Z"));

  assert.equal(state, STORE_MODES.CLOSED_TODAY);
});

test("fechado por hoje reabre automaticamente às 10h", () => {
  const settings = {
    isPaused: true,
    mode: STORE_MODES.CLOSED_TODAY,
    returnTime: returnAtTen
  };

  assert.equal(
    getStoreState(settings, new Date("2026-08-06T12:59:59.999Z")),
    STORE_MODES.CLOSED_TODAY
  );
  assert.equal(
    getStoreState(settings, new Date(returnAtTen)),
    STORE_MODES.OPEN
  );

  assert.deepEqual(
    buildStoreSettingsUpdate(STORE_MODES.OPEN, returnAtTen, "Mensagem"),
    {
      is_paused: false,
      store_mode: STORE_MODES.OPEN,
      return_time: null,
      pause_message: "Mensagem"
    }
  );
});

test("troca entre pausa e fechamento salva apenas a modalidade escolhida", () => {
  const closed = buildStoreSettingsUpdate(
    STORE_MODES.CLOSED_TODAY,
    returnAtTen,
    "Mensagem"
  );
  const paused = buildStoreSettingsUpdate(
    STORE_MODES.PAUSED,
    "2026-08-05T23:00:00.000Z",
    "Mensagem"
  );

  assert.equal(closed.store_mode, STORE_MODES.CLOSED_TODAY);
  assert.equal(paused.store_mode, STORE_MODES.PAUSED);
  assert.notEqual(closed.store_mode, paused.store_mode);
});

test("datetime-local é convertido no fuso America/Santarem", () => {
  const date = storeLocalDateTimeToDate("2026-08-06T10:00");

  assert.equal(date.toISOString(), returnAtTen);
  assert.equal(toStoreLocalDateTimeInput(date), "2026-08-06T10:00");
  assert.equal(
    getTomorrowAtTen(new Date("2026-08-06T00:00:00.000Z")).toISOString(),
    returnAtTen
  );
});

test("return_time ausente ou inválido mantém o datetime-local vazio", () => {
  const emptyValues = [null, undefined, "", "   ", 0, false, "inválido"];

  emptyValues.forEach(value => {
    assert.equal(toValidDate(value), null);
    assert.equal(toStoreLocalDateTimeInput(value), "");
  });
});

test("limpar o horário persiste return_time como null sem alterar a pausa", () => {
  assert.deepEqual(
    buildStoreSettingsUpdate(STORE_MODES.PAUSED, "", "Mensagem"),
    {
      is_paused: true,
      store_mode: STORE_MODES.PAUSED,
      return_time: null,
      pause_message: "Mensagem"
    }
  );

  assert.equal(
    getStoreState({
      isPaused: true,
      mode: STORE_MODES.PAUSED,
      returnTime: null
    }),
    STORE_MODES.PAUSED
  );
});
