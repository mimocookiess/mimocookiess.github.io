const LOG_PREFIX = "[notify-new-order]";
const WEBHOOK_SECRET_HEADER = "x-mimo-webhook-secret";
const HOME_ASSISTANT_TIMEOUT_MS = 7_000;
const MAX_BODY_BYTES = 65_536;

type Environment = {
  get(name: string): string | undefined;
};

type HandlerDependencies = {
  env?: Environment;
  fetch?: typeof fetch;
};

type OrderRecord = {
  id: string;
  order_number: number;
  total: number;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(value);
}

function getOrderRecord(value: unknown): OrderRecord | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  const orderNumber = value.order_number;
  const total = value.total;

  if (
    typeof id !== "string" ||
    !isUuid(id) ||
    typeof orderNumber !== "number" ||
    !Number.isSafeInteger(orderNumber) ||
    orderNumber <= 0 ||
    typeof total !== "number" ||
    !Number.isFinite(total) ||
    total < 0
  ) {
    return null;
  }

  return {
    id,
    order_number: orderNumber,
    total,
  };
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

async function secretsMatch(received: string | null, expected: string) {
  if (!received) return false;

  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const receivedBytes = new Uint8Array(receivedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;

  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= receivedBytes[index] ^ expectedBytes[index];
  }

  return difference === 0;
}

async function parseJsonBody(request: Request): Promise<unknown | null> {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);

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

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

export function createHandler(dependencies: HandlerDependencies = {}) {
  const env = dependencies.env || Deno.env;
  const fetchRequest = dependencies.fetch || fetch;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Método não permitido." },
        405,
      );
    }

    const configuredSecret = env.get("MIMO_DATABASE_WEBHOOK_SECRET");

    if (!configuredSecret) {
      console.error(`${LOG_PREFIX} authentication secret is not configured`);
      return jsonResponse({ error: "Serviço indisponível." }, 503);
    }

    const authenticated = await secretsMatch(
      request.headers.get(WEBHOOK_SECRET_HEADER),
      configuredSecret,
    );

    if (!authenticated) {
      console.warn(`${LOG_PREFIX} authentication failed`);
      return jsonResponse({ error: "Não autorizado." }, 401);
    }

    const payload = await parseJsonBody(request);

    if (
      !isRecord(payload) ||
      !["INSERT", "UPDATE", "DELETE"].includes(String(payload.type)) ||
      typeof payload.table !== "string" ||
      typeof payload.schema !== "string"
    ) {
      console.warn(`${LOG_PREFIX} invalid database webhook payload`);
      return jsonResponse({ error: "Payload inválido." }, 400);
    }

    console.info(
      `${LOG_PREFIX} event received`,
      { type: payload.type, schema: payload.schema, table: payload.table },
    );

    if (
      payload.type !== "INSERT" ||
      payload.schema !== "public" ||
      payload.table !== "orders"
    ) {
      console.info(`${LOG_PREFIX} event ignored`);
      return jsonResponse({ ignored: true });
    }

    const order = getOrderRecord(payload.record);

    if (!order) {
      console.warn(`${LOG_PREFIX} invalid order record`);
      return jsonResponse({ error: "Registro de pedido inválido." }, 400);
    }

    const homeAssistantUrl = getValidHttpsUrl(
      env.get("HOME_ASSISTANT_NEW_ORDER_WEBHOOK_URL"),
    );

    if (!homeAssistantUrl) {
      console.error(
        `${LOG_PREFIX} Home Assistant webhook URL is not configured`,
      );
      return jsonResponse({ error: "Notificação indisponível." }, 503);
    }

    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      HOME_ASSISTANT_TIMEOUT_MS,
    );

    let homeAssistantResponse: Response;

    try {
      homeAssistantResponse = await fetchRequest(homeAssistantUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_number: order.order_number,
          total: order.total,
        }),
        signal: controller.signal,
      });
    } catch {
      const durationMs = Math.round(performance.now() - startedAt);
      const timedOut = controller.signal.aborted;

      console.error(
        `${LOG_PREFIX} Home Assistant request failed`,
        {
          order_id: order.id,
          order_number: order.order_number,
          reason: timedOut ? "timeout" : "network_error",
          duration_ms: durationMs,
        },
      );

      return jsonResponse(
        { error: "Falha ao enviar notificação." },
        timedOut ? 504 : 502,
      );
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = Math.round(performance.now() - startedAt);

    if (!homeAssistantResponse.ok) {
      console.error(
        `${LOG_PREFIX} Home Assistant rejected notification`,
        {
          order_id: order.id,
          order_number: order.order_number,
          status: homeAssistantResponse.status,
          duration_ms: durationMs,
        },
      );

      return jsonResponse({ error: "Falha ao enviar notificação." }, 502);
    }

    console.info(
      `${LOG_PREFIX} notification sent`,
      {
        order_id: order.id,
        order_number: order.order_number,
        status: homeAssistantResponse.status,
        duration_ms: durationMs,
      },
    );

    return jsonResponse({ success: true });
  };
}

if (import.meta.main) {
  Deno.serve(createHandler());
}
