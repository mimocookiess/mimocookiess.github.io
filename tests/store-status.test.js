const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STORE_MODES,
  buildStoreSettingsUpdate,
  getStoreState,
  getNextRegularOpening,
  storeLocalDateTimeToDate,
  toValidDate,
  toStoreLocalDateTimeInput
} = require("../store-status.js");

const returnAtEleven = "2026-08-06T14:00:00.000Z";

test("pausa temporária continua pausa mesmo com retorno no dia seguinte", () => {
  const state = getStoreState({
    isPaused: true,
    mode: STORE_MODES.PAUSED,
    returnTime: returnAtEleven
  }, new Date("2026-08-06T00:00:00.000Z"));

  assert.equal(state, STORE_MODES.PAUSED);
});

test("fechado por hoje permanece fechado durante a noite", () => {
  const state = getStoreState({
    isPaused: true,
    mode: STORE_MODES.CLOSED_TODAY,
    returnTime: returnAtEleven
  }, new Date("2026-08-06T03:30:00.000Z"));

  assert.equal(state, STORE_MODES.CLOSED_TODAY);
});

test("fechado por hoje permanece fechado às 7h50 da manhã seguinte", () => {
  const state = getStoreState({
    isPaused: true,
    mode: STORE_MODES.CLOSED_TODAY,
    returnTime: returnAtEleven
  }, new Date("2026-08-06T10:50:00.000Z"));

  assert.equal(state, STORE_MODES.CLOSED_TODAY);
});

test("fechado por hoje reabre automaticamente às 11h", () => {
  const settings = {
    isPaused: true,
    mode: STORE_MODES.CLOSED_TODAY,
    returnTime: returnAtEleven
  };

  assert.equal(
    getStoreState(settings, new Date("2026-08-06T13:59:59.999Z")),
    STORE_MODES.CLOSED_TODAY
  );
  assert.equal(
    getStoreState(settings, new Date(returnAtEleven)),
    STORE_MODES.OPEN
  );

  assert.deepEqual(
    buildStoreSettingsUpdate(STORE_MODES.OPEN, returnAtEleven, "Mensagem"),
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
    returnAtEleven,
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
  const date = storeLocalDateTimeToDate("2026-08-06T11:00");

  assert.equal(date.toISOString(), returnAtEleven);
  assert.equal(toStoreLocalDateTimeInput(date), "2026-08-06T11:00");
});

test("atalho calcula a próxima abertura regular às 11h", () => {
  const cases = [
    ["terça", "2026-09-01T18:30", "2026-09-02T11:00"],
    ["quarta", "2026-09-02T18:30", "2026-09-03T11:00"],
    ["quinta", "2026-09-03T18:30", "2026-09-04T11:00"],
    ["sexta", "2026-09-04T18:30", "2026-09-05T11:00"],
    ["sábado", "2026-09-05T18:30", "2026-09-06T11:00"],
    ["domingo", "2026-09-06T18:30", "2026-09-08T11:00"],
    ["segunda", "2026-09-07T18:30", "2026-09-08T11:00"]
  ];

  cases.forEach(([day, currentLocalTime, expectedReturn]) => {
    const now = storeLocalDateTimeToDate(currentLocalTime);
    const returnTime = getNextRegularOpening(now);

    assert.equal(toStoreLocalDateTimeInput(returnTime), expectedReturn, day);
  });
});

test("atalho preserva mês e ano nas viradas de calendário", () => {
  const cases = [
    ["2026-05-31T18:30", "2026-06-02T11:00"],
    ["2025-12-31T18:30", "2026-01-01T11:00"]
  ];

  cases.forEach(([currentLocalTime, expectedReturn]) => {
    const now = storeLocalDateTimeToDate(currentLocalTime);
    const returnTime = getNextRegularOpening(now);

    assert.equal(toStoreLocalDateTimeInput(returnTime), expectedReturn);
  });
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
