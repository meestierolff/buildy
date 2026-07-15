import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyStripeCheckoutForPdfCleanup } from "../_shared/photobook.ts";

const PDF_BUCKET = "photobook-pdfs";
const USER_STORAGE_BUCKETS = ["trip-media", "trip-private", "avatars", PDF_BUCKET] as const;
const RETENTION_RECHECK_MS = 24 * 60 * 60 * 1000;
type AdminClient = ReturnType<typeof createClient<any>>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getRequiredEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stripeGet = async (path: string) => {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${getRequiredEnv("STRIPE_SECRET_KEY")}` },
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    // Keep provider payloads (which may contain PII) out of retention logs.
  }
  if (!response.ok) throw new Error(`Stripe checkout lookup failed (${response.status})`);
  return data;
};

const getStripeCheckoutForCleanup = async (sessionId: string) => {
  const session = await stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  const rawIntent = session.payment_intent;
  const paymentIntent = isRecord(rawIntent)
    ? rawIntent
    : typeof rawIntent === "string" && rawIntent
      ? await stripeGet(`/payment_intents/${encodeURIComponent(rawIntent)}`)
      : null;
  return { session, paymentIntent };
};

const collectStoragePaths = async (
  admin: AdminClient,
  bucket: string,
  prefix: string,
): Promise<string[]> => {
  const paths: string[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    for (const item of data || []) {
      const fullPath = `${prefix}/${item.name}`;
      if (item.id === null || item.metadata === null) {
        paths.push(...await collectStoragePaths(admin, bucket, fullPath));
      } else {
        paths.push(fullPath);
      }
    }
    if (!data || data.length < pageSize) break;
  }
  return paths;
};

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const cronSecret = Deno.env.get("PHOTOBOOK_RETENTION_CRON_SECRET")?.trim();
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const admin = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );
    const now = new Date().toISOString();

    const { data: pendingAccountCleanups, error: cleanupQueueError } = await admin
      .from("account_deletion_cleanup_failures")
      .select("user_id, failed_buckets, attempts")
      .order("created_at", { ascending: true })
      .limit(100);
    if (cleanupQueueError) throw cleanupQueueError;

    let recoveredAccountCleanups = 0;
    let failedAccountCleanups = 0;
    for (const pending of pendingAccountCleanups || []) {
      // A prepared queue row can survive a failed auth delete. Never touch an
      // account's files until the service-role auth lookup proves it is gone.
      const authLookup = await admin.auth.admin.getUserById(pending.user_id);
      if (authLookup.data?.user) {
        console.error("Prepared account cleanup still has an active auth user; skipping", pending.user_id);
        failedAccountCleanups += 1;
        await admin.from("account_deletion_cleanup_failures").update({
          attempts: Number(pending.attempts || 0) + 1,
          last_attempt_at: now,
          last_error: "Auth user still exists; storage cleanup was not started",
        }).eq("user_id", pending.user_id);
        continue;
      }
      if (authLookup.error && authLookup.error.status !== 404) {
        console.error("Could not verify deleted auth user before storage cleanup", pending.user_id, authLookup.error);
        failedAccountCleanups += 1;
        await admin.from("account_deletion_cleanup_failures").update({
          attempts: Number(pending.attempts || 0) + 1,
          last_attempt_at: now,
          last_error: "Auth state could not be verified",
        }).eq("user_id", pending.user_id);
        continue;
      }

      const requestedBuckets = Array.isArray(pending.failed_buckets)
        ? pending.failed_buckets.filter((bucket: string) => USER_STORAGE_BUCKETS.includes(bucket as typeof USER_STORAGE_BUCKETS[number]))
        : [...USER_STORAGE_BUCKETS];
      const buckets = requestedBuckets.length > 0 ? requestedBuckets : [...USER_STORAGE_BUCKETS];
      let cleanupFailed = false;
      for (const bucket of buckets) {
        try {
          const paths = await collectStoragePaths(admin, bucket, pending.user_id);
          for (let index = 0; index < paths.length; index += 1000) {
            const { error: removeError } = await admin.storage.from(bucket).remove(paths.slice(index, index + 1000));
            if (removeError) throw removeError;
          }
        } catch (error) {
          cleanupFailed = true;
          console.error("Queued account storage cleanup failed", pending.user_id, bucket, error);
        }
      }
      if (cleanupFailed) {
        failedAccountCleanups += 1;
        await admin.from("account_deletion_cleanup_failures").update({
          attempts: Number(pending.attempts || 0) + 1,
          last_attempt_at: now,
          last_error: "One or more storage buckets could not be cleaned",
        }).eq("user_id", pending.user_id);
      } else {
        const { error: resolvedError } = await admin
          .from("account_deletion_cleanup_failures")
          .delete()
          .eq("user_id", pending.user_id);
        if (resolvedError) {
          console.error("Could not resolve account cleanup queue row", pending.user_id, resolvedError);
          failedAccountCleanups += 1;
        } else {
          recoveredAccountCleanups += 1;
        }
      }
    }
    const { data: dueOrders, error: selectError } = await admin
      .from("photobook_orders")
      .select("id, pdf_storage_path, payment_status, fulfillment_status, status, stripe_checkout_session_id")
      .not("pdf_storage_path", "is", null)
      .not("pdf_delete_after", "is", null)
      .lte("pdf_delete_after", now)
      .limit(500);
    if (selectError) throw selectError;

    const failedOrderIds: string[] = [];
    let removedPdfs = 0;
    let deferredPdfs = 0;
    for (const order of dueOrders || []) {
      const paymentStatus = String(order.payment_status || "");
      const fulfillmentStatus = String(order.fulfillment_status || "");
      const isSafeRefundTerminal = paymentStatus === "refunded"
        && ["cancelled", "shipped", "delivered"].includes(fulfillmentStatus);
      const isLocalPaymentTerminal = ["failed", "cancelled", "expired"].includes(paymentStatus);
      const canDeleteLocally = paymentStatus === "paid"
        || (isLocalPaymentTerminal && !order.stripe_checkout_session_id)
        || isSafeRefundTerminal;

      if (!canDeleteLocally) {
        const recheckAt = new Date(Date.now() + RETENTION_RECHECK_MS).toISOString();
        if (["partially_refunded", "refunded"].includes(paymentStatus)) {
          console.error("Refunded order still requires fulfillment review; preserving PDF", order.id);
          const { error: deferError } = await admin.from("photobook_orders")
            .update({ pdf_delete_after: recheckAt })
            .eq("id", order.id);
          if (deferError) console.error("Could not defer refund-review PDF", order.id, deferError);
          failedOrderIds.push(order.id);
          deferredPdfs += 1;
          continue;
        }

        if (order.stripe_checkout_session_id) {
          try {
            const stripe = await getStripeCheckoutForCleanup(order.stripe_checkout_session_id);
            const cleanupDecision = classifyStripeCheckoutForPdfCleanup(
              stripe.session,
              stripe.paymentIntent,
            );
            if (cleanupDecision === "defer") {
              const { error: deferError } = await admin.from("photobook_orders")
                .update({ pdf_delete_after: recheckAt })
                .eq("id", order.id);
              if (deferError) throw deferError;
              deferredPdfs += 1;
              continue;
            }
            if (cleanupDecision === "paid_review") {
              console.error("Stripe reports payment but local webhook state is not paid", order.id);
              const { error: deferError } = await admin.from("photobook_orders")
                .update({ pdf_delete_after: recheckAt })
                .eq("id", order.id);
              if (deferError) console.error("Could not defer paid-review PDF", order.id, deferError);
              failedOrderIds.push(order.id);
              deferredPdfs += 1;
              continue;
            }
          } catch (stripeError) {
            console.error("Could not verify Stripe state before PDF cleanup", order.id, stripeError);
            const { error: deferError } = await admin.from("photobook_orders")
              .update({ pdf_delete_after: recheckAt })
              .eq("id", order.id);
            if (deferError) console.error("Could not defer unverifiable PDF", order.id, deferError);
            failedOrderIds.push(order.id);
            deferredPdfs += 1;
            continue;
          }
        }
      }

      const { error: removeError } = await admin.storage
        .from(PDF_BUCKET)
        .remove([order.pdf_storage_path]);
      if (removeError) {
        console.error("Retention PDF cleanup failed", order.id, removeError);
        failedOrderIds.push(order.id);
        continue;
      }
      const isAbandonedCheckout = !["paid", "failed", "cancelled", "expired", "refunded"]
        .includes(order.payment_status || "");
      const { error: updateError } = await admin.from("photobook_orders").update({
        pdf_storage_path: null,
        pdf_url: "",
        pdf_url_expires_at: null,
        pdf_delete_after: null,
        ...(isAbandonedCheckout ? {
          status: "payment_expired",
          payment_status: "expired",
          status_updated_at: now,
        } : {}),
      }).eq("id", order.id);
      if (updateError) {
        console.error("Retention order update failed", order.id, updateError);
        failedOrderIds.push(order.id);
        continue;
      }
      removedPdfs += 1;
    }

    const { data: purgedArchives, error: archiveError } = await admin
      .from("photobook_order_archive")
      .delete()
      .lte("retain_until", now)
      .select("source_order_id");
    if (archiveError) throw archiveError;

    const aiUsageCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data: purgedAiUsage, error: aiUsageError } = await admin
      .from("ai_blueprint_usage")
      .delete()
      .lt("usage_date", aiUsageCutoff)
      .select("user_id");
    if (aiUsageError) throw aiUsageError;

    if (failedOrderIds.length > 0 || failedAccountCleanups > 0) {
      return json({
        error: "Some retention records could not be cleaned",
        removedPdfs,
        deferredPdfs,
        failedOrderIds,
        recoveredAccountCleanups,
        failedAccountCleanups,
        purgedArchives: purgedArchives?.length || 0,
        purgedAiUsage: purgedAiUsage?.length || 0,
      }, 500);
    }
    return json({
      ok: true,
      removedPdfs,
      deferredPdfs,
      recoveredAccountCleanups,
      purgedArchives: purgedArchives?.length || 0,
      purgedAiUsage: purgedAiUsage?.length || 0,
    });
  } catch (error) {
    console.error("cleanup-photobook-retention error", error);
    return json({ error: "Retention cleanup failed" }, 500);
  }
});
