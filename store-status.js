(function initializeStoreStatus(globalScope) {
  "use strict";

  const STORE_TIME_ZONE = "America/Santarem";
  const STORE_MODES = Object.freeze({
    OPEN: "open",
    PAUSED: "paused",
    CLOSED_TODAY: "closed_today"
  });
  const VALID_STORE_MODES = new Set(Object.values(STORE_MODES));

  const storeDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  function toValidDate(value) {
    const hasNoValue =
      value === null ||
      value === undefined ||
      value === false ||
      value === 0 ||
      (typeof value === "string" && value.trim() === "");

    if (hasNoValue) return null;

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getStoreDateTimeParts(value) {
    const date = toValidDate(value);

    if (!date) return null;

    return Object.fromEntries(
      storeDateTimeFormatter
        .formatToParts(date)
        .filter(part => part.type !== "literal")
        .map(part => [part.type, Number(part.value)])
    );
  }

  function storeLocalDateTimeToDate(value) {
    const match = String(value || "").match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
    );

    if (!match) return null;

    const [, year, month, day, hour, minute] = match.map(Number);
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    let candidate = new Date(targetAsUtc);

    // Converte o horário de parede da loja em instante UTC sem depender
    // do fuso configurado no aparelho do administrador.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = getStoreDateTimeParts(candidate);

      if (!parts) return null;

      const representedAsUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute
      );
      const adjustment = targetAsUtc - representedAsUtc;

      if (adjustment === 0) break;
      candidate = new Date(candidate.getTime() + adjustment);
    }

    const resultParts = getStoreDateTimeParts(candidate);
    const isExactMatch = resultParts &&
      resultParts.year === year &&
      resultParts.month === month &&
      resultParts.day === day &&
      resultParts.hour === hour &&
      resultParts.minute === minute;

    return isExactMatch ? candidate : null;
  }

  function toStoreLocalDateTimeInput(value) {
    const parts = getStoreDateTimeParts(value);

    if (!parts) return "";

    const pad = number => String(number).padStart(2, "0");

    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` +
      `T${pad(parts.hour)}:${pad(parts.minute)}`;
  }

  function getTomorrowAtTen(now = new Date()) {
    const parts = getStoreDateTimeParts(now);

    if (!parts) return null;

    const tomorrow = new Date(Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day + 1
    ));
    const pad = number => String(number).padStart(2, "0");
    const localValue = `${tomorrow.getUTCFullYear()}-` +
      `${pad(tomorrow.getUTCMonth() + 1)}-` +
      `${pad(tomorrow.getUTCDate())}T10:00`;

    return storeLocalDateTimeToDate(localValue);
  }

  function normalizeStoreMode(value, isPaused = false) {
    if (VALID_STORE_MODES.has(value)) return value;
    return isPaused ? STORE_MODES.PAUSED : STORE_MODES.OPEN;
  }

  function getStoreState(settings, now = new Date()) {
    if (settings?.isPaused !== true) return STORE_MODES.OPEN;

    const mode = normalizeStoreMode(settings.mode, true);
    const returnDate = toValidDate(settings.returnTime);

    if (
      returnDate &&
      now.getTime() >= returnDate.getTime()
    ) {
      return STORE_MODES.OPEN;
    }

    return mode === STORE_MODES.CLOSED_TODAY
      ? STORE_MODES.CLOSED_TODAY
      : STORE_MODES.PAUSED;
  }

  function buildStoreSettingsUpdate(mode, returnTime, pauseMessage) {
    const normalizedMode = normalizeStoreMode(mode);
    const isOpen = normalizedMode === STORE_MODES.OPEN;

    return {
      is_paused: !isOpen,
      store_mode: normalizedMode,
      return_time: isOpen ? null : returnTime || null,
      pause_message: String(pauseMessage || "").trim() || null
    };
  }

  const api = Object.freeze({
    STORE_TIME_ZONE,
    STORE_MODES,
    buildStoreSettingsUpdate,
    getStoreDateTimeParts,
    getStoreState,
    getTomorrowAtTen,
    normalizeStoreMode,
    storeLocalDateTimeToDate,
    toValidDate,
    toStoreLocalDateTimeInput
  });

  globalScope.MimoStoreStatus = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
