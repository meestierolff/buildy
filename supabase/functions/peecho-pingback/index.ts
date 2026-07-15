import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canAdvancePhotobookStatus,
  canAdvanceRefundFulfillment,
  normalizePeechoStatus,
  sha256Hex,
} from "../_shared/photobook.ts";

const PDF_BUCKET = "photobook-pdfs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const timingSafeEqual = (a: string, b: string) => {
  const left = new TextEncoder().encode(a.toLowerCase());
  const right = new TextEncoder().encode(b.toLowerCase());
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
};

const verifySignature = async (signature: string | null, orderId: string) => {
  const secretKey = Deno.env.get("PEECHO_SECRET_KEY")?.trim();
  if (!secretKey || !signature) return false;
  return timingSafeEqual(signature, await sha256Hex(`${secretKey}${orderId}`));
};

const safeTrackingUrl = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const getComplaintRetentionDays = () => {
  const parsed = Number.parseInt(Deno.env.get("PHOTOBOOK_PDF_COMPLAINT_RETENTION_DAYS") || "30", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const merchantReference = body.order_reference
      || url.searchParams.get("order_reference")
      || url.searchParams.get("merchant_reference")
      || body.merchant_reference
      || body.reference;
    const peechoId = body.order_id
      || url.searchParams.get("order_id")
      || body.peecho_id
      || url.searchParams.get("peecho_id");
    const signature = body.signature || url.searchParams.get("signature") || null;
    if (!merchantReference || !peechoId) return json({ error: "order_reference and order_id required" }, 400);
    if (!await verifySignature(String(signature), String(peechoId))) {
      return json({ error: "Invalid Peecho webhook signature" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Webhook is not configured" }, 500);
    const admin = createClient(supabaseUrl, serviceRoleKey);

    let lookup = await admin
      .from("photobook_orders")
      .select("id, peecho_id, merchant_reference, status, payment_status, fulfillment_status, ordered_at, pdf_storage_path, pdf_delete_after")
      .eq("peecho_id", String(peechoId))
      .maybeSingle();
    if (!lookup.data && !lookup.error) {
      lookup = await admin
        .from("photobook_orders")
        .select("id, peecho_id, merchant_reference, status, payment_status, fulfillment_status, ordered_at, pdf_storage_path, pdf_delete_after")
        .eq("merchant_reference", String(merchantReference))
        .maybeSingle();
    }
    if (lookup.error) {
      console.error("Peecho order lookup failed", lookup.error);
      return json({ error: "Could not look up order" }, 500);
    }
    const existing = lookup.data;
    if (!existing) return json({ error: "Order reference not found" }, 404);
    if (existing.merchant_reference !== String(merchantReference)) {
      return json({ error: "Merchant order reference mismatch" }, 409);
    }
    if (existing.peecho_id && String(existing.peecho_id) !== String(peechoId)) {
      return json({ error: "Peecho order id mismatch" }, 409);
    }

    const rawStatus = body.order_state || body.new_status || body.status || "PAID";
    const normalized = normalizePeechoStatus(rawStatus);
    const isRefundPayment = ["partially_refunded", "refunded"].includes(existing.payment_status || "");
    const shouldAdvance = isRefundPayment
      ? canAdvanceRefundFulfillment(existing.fulfillment_status, normalized.fulfillmentStatus)
      : canAdvancePhotobookStatus(existing.status, normalized.status);
    const trackingUrl = safeTrackingUrl(body.tracking_url || body.trackingUrl);
    const trackingCode = body.tracking_code || body.trackingCode;
    const now = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      peecho_id: String(peechoId),
      ordered_at: existing.ordered_at ?? now,
      status_updated_at: now,
      peecho_payload: {
        order_id: String(peechoId),
        order_reference: String(merchantReference),
        order_state: String(rawStatus),
      },
      ...(trackingCode ? { tracking_code: String(trackingCode) } : {}),
      ...(trackingUrl ? { tracking_url: trackingUrl } : {}),
    };
    if (shouldAdvance) {
      updatePayload.status = isRefundPayment ? existing.status : normalized.status;
      updatePayload.fulfillment_status = normalized.fulfillmentStatus;
      updatePayload.fulfillment_claimed_at = null;
      updatePayload.fulfillment_error = body.moderation_reason
        ? "De drukker heeft deze bestelling ter beoordeling geplaatst."
        : normalized.fulfillmentStatus === "failed"
          ? "De drukker kon deze bestelling niet verwerken."
          : null;
      if (["shipped", "delivered"].includes(normalized.status)) {
        const complaintDeleteAfter = new Date(
          Date.now() + getComplaintRetentionDays() * 24 * 60 * 60 * 1000,
        ).toISOString();
        updatePayload.pdf_delete_after = existing.pdf_delete_after
          && new Date(existing.pdf_delete_after).getTime() < new Date(complaintDeleteAfter).getTime()
          ? existing.pdf_delete_after
          : complaintDeleteAfter;
      }
    }

    const { data, error } = await admin
      .from("photobook_orders")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("id, status, fulfillment_status")
      .maybeSingle();
    if (error) {
      console.error("Peecho order update failed", error);
      return json({ error: "Could not update order" }, 500);
    }

    await admin.from("photobook_order_events").insert({
      order_id: existing.id,
      event_type: "peecho_pingback",
      payload: {
        order_id: String(peechoId),
        order_state: String(rawStatus),
        status: shouldAdvance ? normalized.status : existing.status,
        has_tracking: Boolean(trackingCode || trackingUrl),
      },
    });

    if (["cancelled", "refunded"].includes(normalized.status) && existing.pdf_storage_path) {
      const { error: cleanupError } = await admin.storage.from(PDF_BUCKET).remove([existing.pdf_storage_path]);
      if (cleanupError) {
        console.error("Could not remove terminal photobook PDF", cleanupError);
      } else {
        await admin.from("photobook_orders").update({
          pdf_storage_path: null,
          pdf_url: "",
          pdf_url_expires_at: null,
          pdf_delete_after: null,
        }).eq("id", existing.id);
      }
    }
    return json({ ok: true, order: data });
  } catch (error) {
    console.error("peecho-pingback error", error);
    return json({ error: "Pingback failed" }, 500);
  }
});
