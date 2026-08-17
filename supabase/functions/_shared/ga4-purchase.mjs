const CURRENCY = "BRL";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SESSION_ID_PATTERN = /^\d{1,32}$/;
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;

export class Ga4PurchasePayloadError extends Error {
  constructor(code) {
    super(code);
    this.name = "Ga4PurchasePayloadError";
    this.code = code;
  }
}

function toMoney(value, code) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Ga4PurchasePayloadError(code);
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function toPositiveInteger(value, code) {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Ga4PurchasePayloadError(code);
  }

  return number;
}

function normalizeItem(item) {
  const itemId = String(item?.product_slug || "").trim();
  const itemName = String(item?.product_name || "").trim();
  const price = toMoney(item?.unit_price, "invalid_order_item");
  const quantity = toPositiveInteger(
    item?.quantity,
    "invalid_order_item"
  );

  if (!itemId || !itemName || itemId.length > 100 || itemName.length > 100) {
    throw new Ga4PurchasePayloadError("invalid_order_item");
  }

  return {
    item_id: itemId,
    item_name: itemName,
    price,
    quantity
  };
}

function amountsMatch(first, second) {
  return Math.abs(first - second) < 0.005;
}

function getSessionId(value) {
  const normalized = String(value ?? "").trim();

  if (
    !SESSION_ID_PATTERN.test(normalized) ||
    !/[1-9]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function buildGa4PurchasePayload(order) {
  if (
    !order ||
    order.status !== "completed" ||
    !order.completed_at
  ) {
    throw new Ga4PurchasePayloadError("order_not_completed");
  }

  const orderNumber = toPositiveInteger(
    order.order_number,
    "invalid_order_number"
  );
  const clientId = String(order.ga_client_id ?? "").trim();

  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new Ga4PurchasePayloadError("missing_ga_client_id");
  }

  if (!Array.isArray(order.order_items) || order.order_items.length === 0) {
    throw new Ga4PurchasePayloadError("missing_order_items");
  }

  const items = order.order_items.map(normalizeItem);
  const subtotal = toMoney(order.subtotal, "invalid_order_subtotal");
  const shipping = order.delivery_fee === null ||
    order.delivery_fee === undefined
    ? 0
    : toMoney(order.delivery_fee, "invalid_delivery_fee");
  const total = toMoney(order.total, "invalid_order_total");
  const itemValue = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  if (!amountsMatch(subtotal, itemValue)) {
    throw new Ga4PurchasePayloadError("order_item_total_mismatch");
  }

  if (!amountsMatch(total, subtotal + shipping)) {
    throw new Ga4PurchasePayloadError("order_total_mismatch");
  }

  const params = {
    transaction_id: `MIMO-${orderNumber}`,
    currency: CURRENCY,
    value: subtotal,
    items
  };
  const sessionId = getSessionId(order.ga_session_id);

  if (shipping > 0) params.shipping = shipping;
  if (sessionId !== null) params.session_id = sessionId;

  return {
    client_id: clientId,
    events: [{
      name: "purchase",
      params
    }]
  };
}

export function getMeasurementProtocolUrl({
  measurementId,
  apiSecret,
  validation = false
}) {
  const normalizedMeasurementId = String(measurementId || "")
    .trim()
    .toUpperCase();
  const normalizedSecret = String(apiSecret || "").trim();

  if (!MEASUREMENT_ID_PATTERN.test(normalizedMeasurementId)) {
    throw new Error("invalid_measurement_id");
  }

  if (!normalizedSecret) {
    throw new Error("missing_api_secret");
  }

  const path = validation ? "/debug/mp/collect" : "/mp/collect";
  const url = new URL(`https://www.google-analytics.com${path}`);

  url.searchParams.set("measurement_id", normalizedMeasurementId);
  url.searchParams.set("api_secret", normalizedSecret);

  return url;
}

export async function sendGa4Purchase({
  payload,
  measurementId,
  apiSecret,
  fetchImplementation = fetch,
  timeoutMs = 10_000
}) {
  const url = getMeasurementProtocolUrl({ measurementId, apiSecret });
  let response;

  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return {
      ok: false,
      retryable: true,
      errorCode: "ga4_request_failed"
    };
  }

  if (response.ok) {
    return { ok: true, retryable: false, errorCode: null };
  }

  return {
    ok: false,
    // The GA4 Measurement Protocol says not to retry after an HTTP response.
    retryable: false,
    errorCode: `ga4_http_${response.status}`
  };
}

export async function processGa4PurchaseClaim({
  claim,
  loadOrder,
  sendPurchase,
  markSent,
  markFailed
}) {
  let order;

  try {
    order = await loadOrder(claim.purchase_order_id);
  } catch {
    await markFailed(claim, "order_snapshot_unavailable", true);
    return "failed";
  }

  let payload;

  try {
    payload = buildGa4PurchasePayload(order);
  } catch (error) {
    const code = error instanceof Ga4PurchasePayloadError
      ? error.code
      : "invalid_purchase_payload";

    await markFailed(claim, code, false);
    return "failed";
  }

  const result = await sendPurchase(payload);

  if (!result.ok) {
    await markFailed(
      claim,
      result.errorCode || "ga4_request_failed",
      result.retryable === true
    );
    return "failed";
  }

  return await markSent(claim) ? "sent" : "claim_lost";
}
