import { createClient } from "npm:@supabase/supabase-js@2";

import {
  getCorsHeaders,
  isOriginAllowed
} from "../_shared/cors.ts";

const MAX_BODY_BYTES = 32_768;
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048;
const CHECKOUT_ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GA_CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const GA_SESSION_ID_PATTERN = /^\d{1,32}$/;

const SAFE_RPC_ERROR_MESSAGES = new Set([
  "Selecione um bairro de entrega valido.",
  "Bairro de entrega invalido ou indisponivel.",
  "Nome inválido.",
  "Forma de recebimento inválida.",
  "Forma de pagamento inválida.",
  "O endereço é obrigatório para entrega.",
  "As observações devem ter no máximo 500 caracteres.",
  "O pedido precisa ter pelo menos um produto.",
  "O pedido possui produtos demais.",
  "Quantidade inválida.",
  "Produto não encontrado."
]);

type OrderPayload = {
  p_customer_name: string;
  p_delivery_method: string;
  p_payment_method: string;
  p_customer_address: string;
  p_delivery_neighborhood_slug: string | null;
  p_notes: string;
  p_items: Array<{
    slug: string;
    quantity: number;
  }>;
};

type RequestPayload = {
  turnstileToken: string;
  checkoutAttemptId: string;
  analytics: {
    clientId: string | null;
    sessionId: string | null;
  };
  order: OrderPayload;
};

function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
  additionalHeaders: Record<string, string> = {}
) {
  return Response.json(body, {
    status,
    headers: {
      ...getCorsHeaders(request),
      ...additionalHeaders
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function isValidOrder(value: unknown): value is OrderPayload {
  if (!isRecord(value)) return false;

  const items = value.p_items;

  if (
    typeof value.p_customer_name !== "string" ||
    typeof value.p_delivery_method !== "string" ||
    typeof value.p_payment_method !== "string" ||
    typeof value.p_customer_address !== "string" ||
    !(
      value.p_delivery_neighborhood_slug === null ||
      typeof value.p_delivery_neighborhood_slug === "string"
    ) ||
    typeof value.p_notes !== "string" ||
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 20
  ) {
    return false;
  }

  const customerName = value.p_customer_name.trim();
  const deliveryMethod = value.p_delivery_method.trim();
  const paymentMethod = value.p_payment_method.trim();
  const customerAddress = value.p_customer_address.trim();
  const deliveryNeighborhoodSlug =
    typeof value.p_delivery_neighborhood_slug === "string"
      ? value.p_delivery_neighborhood_slug.trim()
      : null;
  const notes = value.p_notes.trim();

  if (
    customerName.length < 2 ||
    customerName.length > 100 ||
    !["Retirada", "Entrega"].includes(deliveryMethod) ||
    ![
      "Pix",
      "Cartão de crédito",
      "Cartão de débito"
    ].includes(paymentMethod) ||
    customerAddress.length > 300 ||
    (deliveryMethod === "Entrega" && customerAddress.length === 0) ||
    (deliveryMethod === "Entrega" &&
      (!deliveryNeighborhoodSlug || deliveryNeighborhoodSlug.length > 100)) ||
    notes.length > 500
  ) {
    return false;
  }

  return items.every(item =>
    isRecord(item) &&
    typeof item.slug === "string" &&
    item.slug.length > 0 &&
    item.slug.length <= 100 &&
    Number.isSafeInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= 20
  );
}

function isValidAnalytics(value: unknown) {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;

  const clientId = value.client_id;
  const sessionId = value.session_id;

  return (
    (clientId === undefined || clientId === null ||
      (typeof clientId === "string" && GA_CLIENT_ID_PATTERN.test(clientId))) &&
    (sessionId === undefined || sessionId === null ||
      (typeof sessionId === "string" && GA_SESSION_ID_PATTERN.test(sessionId)))
  );
}

function getValidHttpsUrl(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value.trim());

    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function getSafeRpcErrorMessage(error: unknown) {
  if (!isRecord(error) || typeof error.message !== "string") {
    return null;
  }

  if (SAFE_RPC_ERROR_MESSAGES.has(error.message)) {
    return error.message;
  }

  if (/^O produto .+ está indisponível\.$/u.test(error.message)) {
    return "Um produto do pedido está indisponível.";
  }

  if (
    /^Há somente \d+ unidade\(s\) disponível\(is\) de .+\.$/u
      .test(error.message)
  ) {
    return "Estoque insuficiente para um produto do pedido.";
  }

  return null;
}

function isValidRpcResult(
  value: unknown,
  deliveryMethod: string
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  const orderNumber = value.order_number;
  const subtotal = value.subtotal;
  const deliveryFee = value.delivery_fee;
  const total = value.total;
  const deliveryNeighborhood = value.delivery_neighborhood;

  const validOrderNumber =
    (typeof orderNumber === "number" &&
      Number.isSafeInteger(orderNumber) &&
      orderNumber > 0) ||
    (typeof orderNumber === "string" && /^\d+$/.test(orderNumber));

  const validSubtotal =
    (typeof subtotal === "number" &&
      Number.isFinite(subtotal) &&
      subtotal >= 0) ||
    (typeof subtotal === "string" &&
      /^\d+(?:\.\d+)?$/.test(subtotal));

  const isValidMoney = (money: unknown) =>
    (typeof money === "number" && Number.isFinite(money) && money >= 0) ||
    (typeof money === "string" && /^\d+(?:\.\d+)?$/.test(money));

  const validDeliveryState = deliveryMethod === "Entrega"
    ? typeof deliveryNeighborhood === "string" &&
      deliveryNeighborhood.trim().length > 0 &&
      deliveryNeighborhood.length <= 100
    : deliveryNeighborhood === null && Number(deliveryFee) === 0;

  return validOrderNumber &&
    validSubtotal &&
    isValidMoney(deliveryFee) &&
    isValidMoney(total) &&
    validDeliveryState &&
    typeof value.payment_method === "string" &&
    typeof value.payment_status === "string" &&
    Math.abs(Number(subtotal) + Number(deliveryFee) - Number(total)) < 0.005;
}

function parseAllowedHostnames() {
  return (Deno.env.get("TURNSTILE_ALLOWED_HOSTNAMES") || "")
    .split(",")
    .map(hostname => hostname.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

async function parseRequest(request: Request): Promise<RequestPayload | null> {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  const declaredLength = Number(
    request.headers.get("content-length") || 0
  );

  if (declaredLength > MAX_BODY_BYTES) return null;

  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return null;
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (!isRecord(payload)) return null;

  const token = payload.turnstileToken;
  const checkoutAttemptId = payload.checkout_attempt_id;
  const analytics = payload.analytics;

  if (
    typeof token !== "string" ||
    token.length < 1 ||
    token.length > MAX_TURNSTILE_TOKEN_LENGTH ||
    (checkoutAttemptId !== undefined &&
      (typeof checkoutAttemptId !== "string" ||
        !CHECKOUT_ATTEMPT_ID_PATTERN.test(checkoutAttemptId))) ||
    !isValidAnalytics(analytics) ||
    !isValidOrder(payload.order)
  ) {
    return null;
  }

  return {
    turnstileToken: token,
    checkoutAttemptId: typeof checkoutAttemptId === "string"
      ? checkoutAttemptId
      : crypto.randomUUID(),
    analytics: {
      clientId: isRecord(analytics) && typeof analytics.client_id === "string"
        ? analytics.client_id
        : null,
      sessionId: isRecord(analytics) && typeof analytics.session_id === "string"
        ? analytics.session_id
        : null
    },
    order: {
      p_customer_name: payload.order.p_customer_name,
      p_delivery_method: payload.order.p_delivery_method,
      p_payment_method: payload.order.p_payment_method,
      p_customer_address: payload.order.p_customer_address,
      p_delivery_neighborhood_slug:
        payload.order.p_delivery_neighborhood_slug,
      p_notes: payload.order.p_notes,
      p_items: payload.order.p_items
    }
  };
}

Deno.serve(async request => {
  if (!isOriginAllowed(request)) {
    return jsonResponse(request, { error: "Origem não permitida." }, 403);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      request,
      { error: "Método não permitido." },
      405,
      { Allow: "POST, OPTIONS" }
    );
  }

  const payload = await parseRequest(request);

  if (!payload) {
    return jsonResponse(request, { error: "Requisição inválida." }, 400);
  }

  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
  const allowedHostnames = parseAllowedHostnames();

  if (!turnstileSecret || allowedHostnames.length === 0) {
    return jsonResponse(
      request,
      { error: "Proteção anti-bot indisponível." },
      503
    );
  }

  const verificationBody = new FormData();
  verificationBody.set("secret", turnstileSecret);
  verificationBody.set("response", payload.turnstileToken);
  verificationBody.set("idempotency_key", crypto.randomUUID());

  let verificationResponse: Response;

  try {
    verificationResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: verificationBody,
        signal: AbortSignal.timeout(10_000)
      }
    );
  } catch {
    return jsonResponse(
      request,
      { error: "Não foi possível validar a verificação de segurança." },
      502
    );
  }

  if (!verificationResponse.ok) {
    return jsonResponse(
      request,
      { error: "Não foi possível validar a verificação de segurança." },
      502
    );
  }

  let verification: unknown;

  try {
    verification = await verificationResponse.json();
  } catch {
    return jsonResponse(
      request,
      { error: "Não foi possível validar a verificação de segurança." },
      502
    );
  }

  if (!isRecord(verification)) {
    return jsonResponse(
      request,
      { error: "Não foi possível validar a verificação de segurança." },
      502
    );
  }

  const verifiedHostname =
    typeof verification.hostname === "string"
      ? normalizeHostname(verification.hostname)
      : "";

  const hostnameAllowed = allowedHostnames
    .map(normalizeHostname)
    .includes(verifiedHostname);

  if (
    verification.success !== true ||
    verification.action !== "create_order" ||
    !hostnameAllowed
  ) {
    return jsonResponse(
      request,
      { error: "Verificação de segurança inválida ou expirada." },
      403
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const validSupabaseUrl = getValidHttpsUrl(supabaseUrl);

  if (!validSupabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      request,
      { error: "Serviço de pedidos indisponível." },
      503
    );
  }

  let data: unknown;
  let rpcError: unknown;

  try {
    const supabaseAdmin = createClient(
      validSupabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const result = await supabaseAdmin.rpc(
      "create_order",
      {
        ...payload.order,
        p_checkout_attempt_id: payload.checkoutAttemptId,
        p_ga_client_id: payload.analytics.clientId,
        p_ga_session_id: payload.analytics.sessionId
      }
    );

    data = result.data;
    rpcError = result.error;
  } catch {
    return jsonResponse(
      request,
      { error: "Não foi possível registrar o pedido." },
      502
    );
  }

  if (rpcError) {
    const safeMessage = getSafeRpcErrorMessage(rpcError);

    return jsonResponse(
      request,
      { error: safeMessage || "Não foi possível registrar o pedido." },
      safeMessage ? 400 : 500
    );
  }

  if (!isValidRpcResult(data, payload.order.p_delivery_method.trim())) {
    return jsonResponse(
      request,
      { error: "Não foi possível registrar o pedido." },
      502
    );
  }

  return jsonResponse(request, data);
});
