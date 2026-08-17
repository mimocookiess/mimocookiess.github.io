const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const helperPath = path.join(
  root,
  "supabase",
  "functions",
  "_shared",
  "ga4-purchase.mjs"
);
const migrationSource = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260816170000_add_ga4_purchase_outbox.sql"
  ),
  "utf8"
);
const snapshotAccessMigrationSource = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260817000000_grant_ga4_purchase_snapshot_read_access.sql"
  ),
  "utf8"
);
const workerSource = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "functions",
    "process-ga4-purchases",
    "index.ts"
  ),
  "utf8"
);
const supabaseConfigSource = fs.readFileSync(
  path.join(root, "supabase", "config.toml"),
  "utf8"
);
const schedulerAuthPath = path.join(
  root,
  "supabase",
  "functions",
  "process-ga4-purchases",
  "scheduler-auth.mjs"
);

const helperPromise = import(pathToFileURL(helperPath).href);
const schedulerAuthPromise = import(pathToFileURL(schedulerAuthPath).href);

function schedulerRequest(headers = {}) {
  return new Request("http://localhost/process-ga4-purchases", { headers });
}

function getOrder(overrides = {}) {
  return {
    order_number: 91,
    subtotal: "30.00",
    delivery_fee: "5.00",
    total: "35.00",
    status: "completed",
    completed_at: "2026-08-16T18:00:00.000Z",
    ga_client_id: "123456789.1786900000",
    ga_session_id: "1786900000",
    customer_name: "NÃO ENVIAR",
    customer_address: "NÃO ENVIAR",
    notes: "NÃO ENVIAR",
    order_items: [{
      product_slug: "tradicional",
      product_name: "Tradicional",
      unit_price: "10.00",
      quantity: 3,
      product_id: "00000000-0000-4000-8000-000000000001"
    }],
    ...overrides
  };
}

test("purchase usa snapshots, subtotal, frete separado e IDs GA4", async () => {
  const { buildGa4PurchasePayload } = await helperPromise;
  const payload = buildGa4PurchasePayload(getOrder());

  assert.deepEqual(payload, {
    client_id: "123456789.1786900000",
    events: [{
      name: "purchase",
      params: {
        transaction_id: "MIMO-91",
        currency: "BRL",
        value: 30,
        items: [{
          item_id: "tradicional",
          item_name: "Tradicional",
          price: 10,
          quantity: 3
        }],
        shipping: 5,
        session_id: "1786900000"
      }
    }]
  });

  const serialized = JSON.stringify(payload);

  for (const forbidden of [
    "customer_name",
    "customer_address",
    "notes",
    "product_id",
    "checkout_attempt_id",
    "NÃO ENVIAR"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("session_id decimal grande é preservado como string e frete zero é omitido", async () => {
  const { buildGa4PurchasePayload } = await helperPromise;
  const payload = buildGa4PurchasePayload(getOrder({
    delivery_fee: null,
    total: "30.00",
    ga_session_id: "99999999999999999999999999999999"
  }));
  const params = payload.events[0].params;

  assert.equal(Object.hasOwn(params, "shipping"), false);
  assert.equal(params.session_id, "99999999999999999999999999999999");
});

test("session_id zero ou não decimal é omitido", async () => {
  const { buildGa4PurchasePayload } = await helperPromise;

  for (const gaSessionId of ["0", "0000", "abc123"]) {
    const payload = buildGa4PurchasePayload(getOrder({
      ga_session_id: gaSessionId
    }));

    assert.equal(
      Object.hasOwn(payload.events[0].params, "session_id"),
      false
    );
  }
});

test("pedido sem client_id não produz payload inventado", async () => {
  const {
    buildGa4PurchasePayload,
    Ga4PurchasePayloadError
  } = await helperPromise;

  assert.throws(
    () => buildGa4PurchasePayload(getOrder({ ga_client_id: null })),
    error =>
      error instanceof Ga4PurchasePayloadError &&
      error.code === "missing_ga_client_id"
  );
});

test("payload inconsistente com snapshots ou total é recusado", async () => {
  const { buildGa4PurchasePayload } = await helperPromise;

  assert.throws(
    () => buildGa4PurchasePayload(getOrder({ subtotal: "31.00" })),
    { message: "order_item_total_mismatch" }
  );
  assert.throws(
    () => buildGa4PurchasePayload(getOrder({ total: "36.00" })),
    { message: "order_total_mismatch" }
  );
});

test("Measurement Protocol envia POST sem expor secret no corpo", async () => {
  const { buildGa4PurchasePayload, sendGa4Purchase } = await helperPromise;
  const payload = buildGa4PurchasePayload(getOrder());
  let capturedUrl;
  let capturedOptions;
  const result = await sendGa4Purchase({
    payload,
    measurementId: "G-QYSQ9P1YRS",
    apiSecret: "secret-de-teste",
    fetchImplementation: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return { ok: true, status: 204 };
    }
  });

  assert.deepEqual(result, {
    ok: true,
    retryable: false,
    errorCode: null
  });
  assert.equal(capturedUrl.pathname, "/mp/collect");
  assert.equal(capturedUrl.searchParams.get("measurement_id"), "G-QYSQ9P1YRS");
  assert.equal(capturedUrl.searchParams.get("api_secret"), "secret-de-teste");
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.body.includes("secret-de-teste"), false);
  assert.deepEqual(JSON.parse(capturedOptions.body), payload);
});

test("endpoint debug é separado e não envia evento aos relatórios", async () => {
  const { getMeasurementProtocolUrl } = await helperPromise;
  const url = getMeasurementProtocolUrl({
    measurementId: "G-QYSQ9P1YRS",
    apiSecret: "secret-de-teste",
    validation: true
  });

  assert.equal(url.pathname, "/debug/mp/collect");
  assert.equal(url.searchParams.get("measurement_id"), "G-QYSQ9P1YRS");
});

test("resposta HTTP é terminal e somente falha sem resposta permite retry", async () => {
  const { sendGa4Purchase } = await helperPromise;
  const base = {
    payload: { client_id: "123.456", events: [] },
    measurementId: "G-QYSQ9P1YRS",
    apiSecret: "secret-de-teste"
  };

  assert.deepEqual(
    await sendGa4Purchase({
      ...base,
      fetchImplementation: async () => ({ ok: false, status: 500 })
    }),
    { ok: false, retryable: false, errorCode: "ga4_http_500" }
  );
  assert.deepEqual(
    await sendGa4Purchase({
      ...base,
      fetchImplementation: async () => ({ ok: false, status: 429 })
    }),
    { ok: false, retryable: false, errorCode: "ga4_http_429" }
  );
  assert.deepEqual(
    await sendGa4Purchase({
      ...base,
      fetchImplementation: async () => ({ ok: false, status: 400 })
    }),
    { ok: false, retryable: false, errorCode: "ga4_http_400" }
  );
  assert.deepEqual(
    await sendGa4Purchase({
      ...base,
      fetchImplementation: async () => {
        throw new Error("resposta que não deve ir para logs");
      }
    }),
    { ok: false, retryable: true, errorCode: "ga4_request_failed" }
  );
});

test("worker marca sent no sucesso e failed controlado sem duplicar o claim", async () => {
  const { processGa4PurchaseClaim } = await helperPromise;
  const claim = {
    outbox_id: "00000000-0000-4000-8000-000000000010",
    purchase_order_id: "00000000-0000-4000-8000-000000000091",
    claim_token: "00000000-0000-4000-8000-000000000011"
  };
  const calls = [];

  const sentResult = await processGa4PurchaseClaim({
    claim,
    loadOrder: async () => getOrder(),
    sendPurchase: async () => ({ ok: true }),
    markSent: async receivedClaim => {
      calls.push(["sent", receivedClaim.outbox_id]);
      return true;
    },
    markFailed: async () => calls.push(["failed"])
  });

  assert.equal(sentResult, "sent");
  assert.deepEqual(calls, [["sent", claim.outbox_id]]);

  calls.length = 0;

  const failedResult = await processGa4PurchaseClaim({
    claim,
    loadOrder: async () => getOrder(),
    sendPurchase: async () => ({
      ok: false,
      retryable: true,
      errorCode: "ga4_http_500"
    }),
    markSent: async () => false,
    markFailed: async (receivedClaim, code, retryable) => {
      calls.push(["failed", receivedClaim.claim_token, code, retryable]);
    }
  });

  assert.equal(failedResult, "failed");
  assert.deepEqual(calls, [[
    "failed",
    claim.claim_token,
    "ga4_http_500",
    true
  ]]);
});

test("client_id ausente vira falha terminal sem chamada ao Google", async () => {
  const { processGa4PurchaseClaim } = await helperPromise;
  let sent = false;
  let failure;

  const result = await processGa4PurchaseClaim({
    claim: {
      outbox_id: "outbox",
      purchase_order_id: "order",
      claim_token: "claim"
    },
    loadOrder: async () => getOrder({ ga_client_id: null }),
    sendPurchase: async () => {
      sent = true;
      return { ok: true };
    },
    markSent: async () => true,
    markFailed: async (claim, code, retryable) => {
      failure = { claim, code, retryable };
    }
  });

  assert.equal(result, "failed");
  assert.equal(sent, false);
  assert.equal(failure.code, "missing_ga_client_id");
  assert.equal(failure.retryable, false);
});

test("estrutura SQL declara trigger de transição e uma outbox por pedido", () => {
  assert.match(
    migrationSource,
    /unique \(order_id\)/i
  );
  assert.match(
    migrationSource,
    /after update of status on public\.orders[\s\S]*old\.status is distinct from new\.status[\s\S]*new\.status = 'completed'/i
  );
  assert.match(migrationSource, /on conflict \(order_id\) do nothing/i);
  assert.match(
    migrationSource,
    /new\.completed_at := now\(\)/i
  );
  assert.doesNotMatch(
    migrationSource,
    /insert into public\.ga4_purchase_outbox[^;]*\bselect\b/i
  );
  assert.doesNotMatch(
    migrationSource,
    /create or replace function public\.(complete_order|confirm_order|cancel_order)/i
  );
});

test("estrutura SQL do claim inclui lock, token, lease e limite", () => {
  assert.match(migrationSource, /for update skip locked/i);
  assert.match(migrationSource, /status = 'sending'/i);
  assert.match(migrationSource, /claim_token = gen_random_uuid\(\)/i);
  assert.match(migrationSource, /claim_token = p_claim_token/i);
  assert.match(migrationSource, /attempt_count < 5/i);
  assert.match(migrationSource, /interval '15 minutes'/i);
  assert.match(
    migrationSource,
    /status = 'sending'[\s\S]*last_attempt_at is not null/i
  );
  assert.match(migrationSource, /status in \('pending', 'failed'\)/i);
  assert.match(migrationSource, /last_error = 'worker_lease_expired'/i);
  assert.match(
    migrationSource,
    /status = 'sent',[\s\S]*sent_at = now\(\)/i
  );
  assert.match(
    migrationSource,
    /status = 'failed',[\s\S]*next_attempt_at = case/i
  );
});

test("worker e frontend não contêm segredo nem campos pessoais no payload", () => {
  for (const forbidden of [
    "customer_name",
    "customer_address",
    "notes",
    "checkout_attempt_id",
    "turnstileToken",
    "wa.me"
  ]) {
    assert.equal(workerSource.includes(forbidden), false);
  }

  const frontendSource = [
    "config.js",
    "index.html",
    "script.js",
    "analytics.js",
    "admin/admin.js"
  ].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");

  assert.doesNotMatch(frontendSource, /GA4_API_SECRET|api_secret|\/mp\/collect/);
});

test("autenticação do scheduler rejeita credenciais ausentes ou incorretas antes do claim", async () => {
  const { isSchedulerAuthorized } = await schedulerAuthPromise;
  const schedulerSecret = "scheduler-secret-sintetico-c2";
  let claimCalls = 0;

  async function guardedCall(headers, runtimeSecret = schedulerSecret) {
    const authorized = await isSchedulerAuthorized(
      schedulerRequest(headers),
      runtimeSecret
    );

    if (!authorized) {
      return { status: 401, body: { error: "Unauthorized." } };
    }

    claimCalls += 1;
    return { status: 200 };
  }

  const rejected = await Promise.all([
    guardedCall({}),
    guardedCall({ "x-mimo-scheduler-secret": "incorreto" }),
    guardedCall({ "x-mimo-scheduler-secret": schedulerSecret }, ""),
    guardedCall({ authorization: "Bearer legacy-service-role-jwt" }),
    guardedCall({ authorization: "Bearer authenticated-user-jwt" })
  ]);

  assert.deepEqual(
    rejected,
    Array.from({ length: 5 }, () => ({
      status: 401,
      body: { error: "Unauthorized." }
    }))
  );
  assert.equal(claimCalls, 0);
});

test("segredo correto autoriza mesmo com headers irrelevantes", async () => {
  const { isSchedulerAuthorized } = await schedulerAuthPromise;
  const schedulerSecret = "scheduler-secret-sintetico-c2";

  assert.equal(
    await isSchedulerAuthorized(schedulerRequest({
      "x-mimo-scheduler-secret": schedulerSecret,
      authorization: "Bearer credencial-irrelevante",
      "x-cabecalho-irrelevante": "valor"
    }), schedulerSecret),
    true
  );
});

test("duas chamadas autenticadas preservam a exclusividade do claim simulado", async () => {
  const { isSchedulerAuthorized } = await schedulerAuthPromise;
  const schedulerSecret = "scheduler-secret-sintetico-c2";
  let availableClaims = 1;

  async function authenticatedClaim() {
    const authorized = await isSchedulerAuthorized(
      schedulerRequest({ "x-mimo-scheduler-secret": schedulerSecret }),
      schedulerSecret
    );
    assert.equal(authorized, true);

    await Promise.resolve();
    const claimed = availableClaims;
    availableClaims = 0;
    return claimed;
  }

  const results = await Promise.all([
    authenticatedClaim(),
    authenticatedClaim()
  ]);

  assert.equal(results.reduce((total, claimed) => total + claimed, 0), 1);
});

test("worker autentica pelo segredo dedicado antes do RPC e desabilita verificação JWT da plataforma", () => {
  const authPosition = workerSource.indexOf("isSchedulerAuthorized(request");
  const claimPosition = workerSource.indexOf('"claim_ga4_purchase_outbox"');

  assert.notEqual(authPosition, -1);
  assert.ok(authPosition < claimPosition);
  assert.match(workerSource, /Deno\.env\.get\("GA4_SCHEDULER_SECRET"\)/);
  assert.doesNotMatch(workerSource, /headers\.get\("authorization"\)/i);
  assert.doesNotMatch(workerSource, /Bearer \$\{serviceRoleKey\}/);
  assert.match(
    supabaseConfigSource,
    /\[functions\.process-ga4-purchases\]\s+verify_jwt = false/
  );
});

test("migration corretiva concede ao service_role apenas as colunas do snapshot GA4", () => {
  assert.match(
    snapshotAccessMigrationSource,
    /grant select \(\s*id,\s*order_number,\s*subtotal,\s*delivery_fee,\s*total,\s*status,\s*completed_at,\s*ga_client_id,\s*ga_session_id\s*\)\s*on table public\.orders\s*to service_role/si
  );
  assert.match(
    snapshotAccessMigrationSource,
    /grant select \(\s*order_id,\s*product_slug,\s*product_name,\s*unit_price,\s*quantity\s*\)\s*on table public\.order_items\s*to service_role/si
  );
  assert.doesNotMatch(
    snapshotAccessMigrationSource,
    /grant select\s+on table public\.(orders|order_items)/i
  );
  assert.doesNotMatch(
    snapshotAccessMigrationSource,
    /customer_name|customer_address|notes|checkout_attempt_id/i
  );
});
