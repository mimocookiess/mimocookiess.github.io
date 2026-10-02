(function initializeStoreStatus(globalScope) {
  "use strict";

  const STORE_TIME_ZONE = "America/Santarem";
  const REGULAR_OPEN_HOUR = 11;
  const REGULAR_CLOSE_HOUR = 19;
  const STORE_MODES = Object.freeze({
    OPEN: "open",
    AUTOMATIC: "automatic",
    MANUAL_OPEN: "manual_open",
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

  function getStoreLocalDate(value) {
    const parts = getStoreDateTimeParts(value);
    if (!parts) return null;
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }

  function localDateAtHour(localDate, hour) {
    const pad = number => String(number).padStart(2, "0");
    return storeLocalDateTimeToDate(
      `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-` +
      `${pad(localDate.getUTCDate())}T${pad(hour)}:00`
    );
  }

  function isRegularlyOpen(now = new Date()) {
    const parts = getStoreDateTimeParts(now);
    const localDate = getStoreLocalDate(now);
    if (!parts || !localDate || localDate.getUTCDay() === 1) return false;
    return parts.hour >= REGULAR_OPEN_HOUR && parts.hour < REGULAR_CLOSE_HOUR;
  }

  function getNextRegularOpening(now = new Date(), afterToday = false) {
    const localDate = getStoreLocalDate(now);
    if (!localDate) return null;
    for (let offset = afterToday ? 1 : 0; offset <= 8; offset += 1) {
      const candidateDate = new Date(localDate.getTime());
      candidateDate.setUTCDate(candidateDate.getUTCDate() + offset);
      if (candidateDate.getUTCDay() === 1) continue;
      const candidate = localDateAtHour(candidateDate, REGULAR_OPEN_HOUR);
      if (candidate && candidate >= now) return candidate;
    }
    return null;
  }

  function getNextStoreMidnight(now = new Date()) {
    const localDate = getStoreLocalDate(now);
    if (!localDate) return null;
    localDate.setUTCDate(localDate.getUTCDate() + 1);
    return localDateAtHour(localDate, 0);
  }

  function normalizeStoreMode(value, isPaused = false) {
    if (value === STORE_MODES.AUTOMATIC || value === STORE_MODES.MANUAL_OPEN) {
      return STORE_MODES.OPEN;
    }
    if (VALID_STORE_MODES.has(value)) return value;
    return isPaused ? STORE_MODES.PAUSED : STORE_MODES.OPEN;
  }

  function getStoreState(settings, now = new Date()) {
    const manualOpenUntil = toValidDate(settings?.manualOpenUntil);
    if (manualOpenUntil && now < manualOpenUntil) return STORE_MODES.OPEN;

    if (settings?.isPaused === true) {
      const returnDate = toValidDate(settings.returnTime);
      if (!returnDate || now < returnDate) {
        return normalizeStoreMode(settings.mode, true) === STORE_MODES.CLOSED_TODAY
          ? STORE_MODES.CLOSED_TODAY
          : STORE_MODES.PAUSED;
      }
    }

    return isRegularlyOpen(now) ? STORE_MODES.OPEN : STORE_MODES.CLOSED_TODAY;
  }

  function buildStoreSettingsUpdate(
    mode,
    returnTime,
    pauseMessage,
    now = new Date()
  ) {
    const normalizedMode = mode === STORE_MODES.MANUAL_OPEN
      ? STORE_MODES.MANUAL_OPEN
      : mode === STORE_MODES.AUTOMATIC
        ? STORE_MODES.AUTOMATIC
        : normalizeStoreMode(mode);
    const isPaused = [STORE_MODES.PAUSED, STORE_MODES.CLOSED_TODAY]
      .includes(normalizedMode);
    return {
      is_paused: isPaused,
      store_mode: isPaused ? normalizedMode : STORE_MODES.OPEN,
      return_time: isPaused ? returnTime || null : null,
      pause_message: String(pauseMessage || "").trim() || null,
      manual_open_until: normalizedMode === STORE_MODES.MANUAL_OPEN
        ? getNextStoreMidnight(now)?.toISOString() || null
        : null
    };
  }

  function getNextStateChange(settings, now = new Date()) {
    const candidates = [
      toValidDate(settings?.manualOpenUntil),
      settings?.isPaused ? toValidDate(settings.returnTime) : null,
      getNextRegularOpening(now)
    ];
    const localDate = getStoreLocalDate(now);
    if (localDate && localDate.getUTCDay() !== 1) {
      candidates.push(localDateAtHour(localDate, REGULAR_CLOSE_HOUR));
    }
    return candidates
      .filter(date => date && date > now)
      .sort((first, second) => first - second)[0] || null;
  }

  function watchStoreStatus({ window, document, refresh, render, getSettings, active = () => true }) {
    let timer;
    let running = false;
    const schedule = () => {
      const now = new Date();
      const transition = getNextStateChange(getSettings(), now);
      const delay = transition ? transition.getTime() - now.getTime() + 50 : 60000;
      timer = window.setTimeout(tick, Math.max(50, Math.min(delay, 60000)));
    };
    async function tick() {
      window.clearTimeout(timer);
      if (running) {
        if (active()) render();
        schedule();
        return;
      }
      if (!active()) {
        schedule();
        return;
      }
      running = true;
      try {
        render();
        await refresh();
      } finally {
        running = false;
        schedule();
      }
    }
    window.addEventListener("focus", tick);
    window.addEventListener("pageshow", tick);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tick();
    });
    tick();
    return tick;
  }

  const api = Object.freeze({
    STORE_TIME_ZONE,
    REGULAR_OPEN_HOUR,
    REGULAR_CLOSE_HOUR,
    watchStoreStatus,
    STORE_MODES,
    buildStoreSettingsUpdate,
    getStoreDateTimeParts,
    getStoreState,
    getNextRegularOpening,
    getNextStateChange,
    getNextStoreMidnight,
    isRegularlyOpen,
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
