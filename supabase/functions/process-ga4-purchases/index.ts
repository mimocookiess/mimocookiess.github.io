import { createClient } from "npm:@supabase/supabase-js@2";

import {
  processGa4PurchaseClaim,
  sendGa4Purchase
} from "../_shared/ga4-purchase.mjs";
import { isSchedulerAuthorized } from "./scheduler-auth.mjs";

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 20;

type PurchaseClaim = {
  outbox_id: string;
  purchase_order_id: string;
  claim_token: string;
};

type Ga4PurchasePayload = {
  client_id: string;
  events: Array<{
    name: string;
    params: Record<string, unknown>;
  }>;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function getBatchSize(request: Request) {
  const value = new URL(request.url).searchParams.get("limit");
  const number = Number(value || DEFAULT_BATCH_SIZE);

  if (!Number.isSafeInteger(number) || number < 1) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(number, MAX_BATCH_SIZE);
}

Deno.serve(async request => {
  const schedulerSecret = Deno.env.get("GA4_SCHEDULER_SECRET") || "";

  if (!await isSchedulerAuthorized(request, schedulerSecret)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const measurementId = Deno.env.get("GA4_MEASUREMENT_ID") || "";
  const apiSecret = Deno.env.get("GA4_API_SECRET") || "";

  if (!supabaseUrl || !serviceRoleKey || !measurementId || !apiSecret) {
    return jsonResponse({ error: "Worker indisponível." }, 503);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  const { data: claims, error: claimError } = await supabaseAdmin.rpc(
    "claim_ga4_purchase_outbox",
    { p_limit: getBatchSize(request) }
  );

  if (claimError || !Array.isArray(claims)) {
    return jsonResponse({ error: "Não foi possível obter a fila." }, 500);
  }

  const summary = {
    claimed: claims.length,
    sent: 0,
    failed: 0,
    claim_lost: 0
  };

  for (const claim of claims as PurchaseClaim[]) {
    let result = "failed";

    try {
      result = await processGa4PurchaseClaim({
        claim,
        loadOrder: async (orderId: string) => {
          const { data, error } = await supabaseAdmin
            .from("orders")
            .select(`
              order_number,
              subtotal,
              delivery_fee,
              total,
              status,
              completed_at,
              ga_client_id,
              ga_session_id,
              order_items (
                product_slug,
                product_name,
                unit_price,
                quantity
              )
            `)
            .eq("id", orderId)
            .single();

          if (error || !data) {
            throw new Error("order_snapshot_unavailable");
          }

          return data;
        },
        sendPurchase: (payload: Ga4PurchasePayload) => sendGa4Purchase({
          payload,
          measurementId,
          apiSecret
        }),
        markSent: async (activeClaim: PurchaseClaim) => {
          const { data, error } = await supabaseAdmin.rpc(
            "mark_ga4_purchase_sent",
            {
              p_outbox_id: activeClaim.outbox_id,
              p_claim_token: activeClaim.claim_token
            }
          );

          return !error && data === true;
        },
        markFailed: async (
          activeClaim: PurchaseClaim,
          errorCode: string,
          retryable: boolean
        ) => {
          const { data, error } = await supabaseAdmin.rpc(
            "mark_ga4_purchase_failed",
            {
              p_outbox_id: activeClaim.outbox_id,
              p_claim_token: activeClaim.claim_token,
              p_error_code: errorCode,
              p_retryable: retryable
            }
          );

          if (error || data !== true) {
            throw new Error("failed_to_mark_ga4_purchase_failed");
          }
        }
      });
    } catch {
      result = "failed";
    }

    if (result === "sent") summary.sent += 1;
    if (result === "failed") summary.failed += 1;
    if (result === "claim_lost") summary.claim_lost += 1;
  }

  return jsonResponse(summary);
});
