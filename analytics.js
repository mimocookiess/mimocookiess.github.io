(function initializeMimoAnalytics(global) {
  "use strict";

  const CURRENCY = "BRL";
  const IDENTIFIER_TIMEOUT_MS = 250;
  const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
  const SESSION_ID_PATTERN = /^\d{1,32}$/;
  const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;
  let measurementId = "";
  let analyticsEnabled = false;
  let identifiers = {
    client_id: null,
    session_id: null
  };

  function toNonNegativeNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function toPositiveInteger(value) {
    const number = Number(value);

    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function buildItem(product, quantity) {
    const itemId = String(product?.id || "").trim();
    const itemName = String(product?.name || "").trim();
    const price = toNonNegativeNumber(product?.price);
    const normalizedQuantity = toPositiveInteger(quantity);

    if (!itemId || !itemName || price === null || !normalizedQuantity) {
      return null;
    }

    return {
      item_id: itemId,
      item_name: itemName,
      price,
      quantity: normalizedQuantity
    };
  }

  function buildItems(lines) {
    if (!Array.isArray(lines)) return [];

    return lines
      .map(line => buildItem(line?.product, line?.quantity))
      .filter(Boolean);
  }

  function buildCartPayload(lines, explicitValue) {
    const items = buildItems(lines);
    const calculatedValue = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const normalizedExplicitValue = toNonNegativeNumber(explicitValue);

    return {
      currency: CURRENCY,
      value: normalizedExplicitValue ?? calculatedValue,
      items
    };
  }

  function sendEvent(name, params) {
    if (!analyticsEnabled || typeof global.gtag !== "function") return false;

    try {
      global.gtag("event", name, params);
      return true;
    } catch {
      return false;
    }
  }

  function trackItemChange(name, product, quantity) {
    const item = buildItem(product, quantity);

    if (!item) return false;

    return sendEvent(name, {
      currency: CURRENCY,
      value: item.price * item.quantity,
      items: [item]
    });
  }

  function trackAddToCart(product, quantityAdded = 1) {
    return trackItemChange("add_to_cart", product, quantityAdded);
  }

  function trackRemoveFromCart(product, quantityRemoved = 1) {
    return trackItemChange("remove_from_cart", product, quantityRemoved);
  }

  function trackViewCart(lines) {
    return sendEvent("view_cart", buildCartPayload(lines));
  }

  function trackBeginCheckout(lines) {
    return sendEvent("begin_checkout", buildCartPayload(lines));
  }

  function trackOrderCreated({ orderNumber, subtotal, lines } = {}) {
    const normalizedOrderNumber = String(orderNumber ?? "").trim();
    const normalizedSubtotal = toNonNegativeNumber(subtotal);

    if (!/^\d+$/.test(normalizedOrderNumber) || normalizedSubtotal === null) {
      return false;
    }

    return sendEvent("order_created", {
      order_id: `MIMO-${normalizedOrderNumber}`,
      currency: CURRENCY,
      value: normalizedSubtotal,
      items: buildItems(lines)
    });
  }

  function normalizeIdentifier(fieldName, value) {
    const normalizedValue = String(value ?? "").trim();
    const pattern = fieldName === "client_id"
      ? CLIENT_ID_PATTERN
      : SESSION_ID_PATTERN;

    return pattern.test(normalizedValue) ? normalizedValue : null;
  }

  function getIdentifier(fieldName, timeoutMs) {
    return new Promise(resolve => {
      if (!analyticsEnabled || typeof global.gtag !== "function") {
        resolve(null);
        return;
      }

      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        global.clearTimeout(timeoutId);
        resolve(normalizeIdentifier(fieldName, value));
      };
      const timeoutId = global.setTimeout(() => finish(null), timeoutMs);

      try {
        global.gtag("get", measurementId, fieldName, finish);
      } catch {
        finish(null);
      }
    });
  }

  async function getIdentifiers({ timeoutMs = IDENTIFIER_TIMEOUT_MS } = {}) {
    if (!analyticsEnabled) {
      return { ...identifiers };
    }

    const normalizedTimeout = Number.isFinite(Number(timeoutMs))
      ? Math.max(0, Number(timeoutMs))
      : IDENTIFIER_TIMEOUT_MS;
    const [clientId, sessionId] = await Promise.all([
      identifiers.client_id
        ? Promise.resolve(identifiers.client_id)
        : getIdentifier("client_id", normalizedTimeout),
      identifiers.session_id
        ? Promise.resolve(identifiers.session_id)
        : getIdentifier("session_id", normalizedTimeout)
    ]);

    identifiers = {
      client_id: clientId || identifiers.client_id,
      session_id: sessionId || identifiers.session_id
    };

    return { ...identifiers };
  }

  function initializeGoogleTag() {
    const configuredMeasurementId = typeof STORE_CONFIG !== "undefined"
      ? String(STORE_CONFIG.gaMeasurementId || "").trim().toUpperCase()
      : "";

    if (
      !MEASUREMENT_ID_PATTERN.test(configuredMeasurementId) ||
      !global.document
    ) {
      return;
    }

    measurementId = configuredMeasurementId;
    analyticsEnabled = true;
    global.dataLayer = global.dataLayer || [];
    global.gtag = global.gtag || function gtag() {
      global.dataLayer.push(arguments);
    };

    global.gtag("js", new Date());
    global.gtag("config", measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });

    if (!global.document.querySelector("#mimo-google-tag")) {
      const script = global.document.createElement("script");

      script.id = "mimo-google-tag";
      script.async = true;
      script.src =
        `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      global.document.head.append(script);
    }

    global.setTimeout(() => {
      getIdentifiers({ timeoutMs: 1_000 }).catch(() => {});
    }, 0);
  }

  const api = Object.freeze({
    buildItems,
    getIdentifiers,
    trackAddToCart,
    trackBeginCheckout,
    trackOrderCreated,
    trackRemoveFromCart,
    trackViewCart
  });

  global.MimoAnalytics = api;
  initializeGoogleTag();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
