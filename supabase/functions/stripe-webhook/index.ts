import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const encoder = new TextEncoder();

const getRequiredEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

const timingSafeEqual = (left: string, right: string) => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
};

const hmacSha256Hex = async (secret: string, payload: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const verifyStripeSignature = async (body: string, signatureHeader: string | null) => {
  const webhookSecret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${body}`);
  return timingSafeEqual(expected, signature);
};

const normalizeOfferingId = (value: string) => (/^\d+$/.test(value) ? Number(value) : value);

const splitName = (name: string | null | undefined) => {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Buildy", lastName: "Klant" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "." };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
};

const buildPeechoAddress = (session: Record<string, any>) => {
  // Newer Stripe API versions expose shipping under collected_information.
  const shipping = session.collected_information?.shipping_details || session.shipping_details || {};
  const customer = session.customer_details || {};
  const address = shipping.address || customer.address || {};
  const { firstName, lastName } = splitName(shipping.name || customer.name);

  return {
    email_address: customer.email || session.customer_email || "",
    shipping_address: {
      first_name: firstName,
      last_name: lastName,
      address_line_1: address.line1 || "",
      address_line_2: address.line2 || "",
      zip_code: address.postal_code || "",
      city: address.city || "",
      state: address.state || null,
      country_code: address.country || "",
    },
  };
};

const submitPeechoOrder = async (
  admin: ReturnType<typeof createClient>,
  order: Record<string, any>,
  session: Record<string, any>,
) => {
  const peechoOrderUrl = Deno.env.get("PEECHO_ORDER_API_URL")?.trim();
  const peechoApiKey = Deno.env.get("PEECHO_MERCHANT_API_KEY")?.trim();
  const offeringId = Deno.env.get("PEECHO_OFFERING_ID")?.trim();

  if (!peechoOrderUrl || !peechoApiKey || !offeringId) {
    const missing = [
      !peechoOrderUrl ? "PEECHO_ORDER_API_URL" : null,
      !peechoApiKey ? "PEECHO_MERCHANT_API_KEY" : null,
      !offeringId ? "PEECHO_OFFERING_ID" : null,
    ].filter(Boolean);
    const message = `Peecho fulfillment wacht op configuratie: ${missing.join(", ")}`;
    await admin.from("photobook_orders").update({
      status: "paid_pending_fulfillment",
      fulfillment_status: "needs_configuration",
      fulfillment_error: message,
      status_updated_at: new Date().toISOString(),
    }).eq("id", order.id);
    return { ok: false, skipped: true, error: message };
  }

  const contentWidth = Number(Deno.env.get("PEECHO_CONTENT_WIDTH_MM") || 297);
  const contentHeight = Number(Deno.env.get("PEECHO_CONTENT_HEIGHT_MM") || 210);
  const payload = {
    merchant_api_key: peechoApiKey,
    purchase_order: order.merchant_reference,
    currency: (order.payment_currency || "eur").toUpperCase(),
    item_details: [
      {
        item_reference: order.merchant_reference,
        offering_id: normalizeOfferingId(offeringId),
        quantity: 1,
        file_details: {
          content_url: order.pdf_url,
          content_width: contentWidth,
          content_height: contentHeight,
          number_of_pages: order.page_count,
        },
      },
    ],
    address_details: buildPeechoAddress(session),
  };

  const response = await fetch(peechoOrderUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  let responseBody: unknown = responseText;
  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBody = responseText;
  }

  await admin.from("photobook_order_events").insert({
    order_id: order.id,
    event_type: "peecho_order_submit_attempt",
    payload: { request: payload, response_status: response.status, response: responseBody },
  });

  if (!response.ok) {
    const message = `Peecho order aanmaken mislukt (${response.status})`;
    await admin.from("photobook_orders").update({
      status: "paid_pending_fulfillment",
      fulfillment_status: "failed",
      fulfillment_error: message,
      peecho_order_request: payload,
      status_updated_at: new Date().toISOString(),
    }).eq("id", order.id);
    return { ok: false, error: message };
  }

  const peechoId =
    typeof responseBody === "object" && responseBody !== null
      ? (responseBody as Record<string, any>).order_id
        || (responseBody as Record<string, any>).orderId
        || (responseBody as Record<string, any>).id
      : null;

  await admin.from("photobook_orders").update({
    status: "submitted_to_peecho",
    fulfillment_status: "submitted",
    fulfillment_error: null,
    peecho_id: peechoId ? String(peechoId) : order.peecho_id,
    peecho_payload: { api_response: responseBody },
    peecho_order_request: payload,
    ordered_at: new Date().toISOString(),
    status_updated_at: new Date().toISOString(),
  }).eq("id", order.id);

  return { ok: true, peechoId };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const rawBody = await req.text();
    const validSignature = await verifyStripeSignature(rawBody, req.headers.get("Stripe-Signature"));
    if (!validSignature) return json({ error: "Invalid Stripe signature" }, 401);

    const event = JSON.parse(rawBody);
    const session = event?.data?.object || {};
    const orderId = session?.metadata?.order_id || session?.client_reference_id;
    if (!orderId) return json({ ok: true, ignored: "missing order id" });

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceRoleKey);

    await admin.from("photobook_order_events").insert({
      order_id: orderId,
      event_type: `stripe_${event.type || "event"}`,
      payload: event,
    });

    const { data: order, error: orderError } = await admin
      .from("photobook_orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      console.error("Order lookup failed for Stripe event", orderError, orderId);
      return json({ error: "Order not found" }, 404);
    }

    const now = new Date().toISOString();
    if (event.type === "checkout.session.expired") {
      await admin.from("photobook_orders").update({
        status: "payment_expired",
        payment_status: "expired",
        stripe_payload: session,
        status_updated_at: now,
      }).eq("id", order.id);
      return json({ ok: true });
    }

    if (event.type === "checkout.session.async_payment_failed") {
      await admin.from("photobook_orders").update({
        status: "payment_failed",
        payment_status: "failed",
        stripe_payload: session,
        status_updated_at: now,
      }).eq("id", order.id);
      return json({ ok: true });
    }

    // checkout.session.completed fires with payment_status "unpaid" for async
    // payment methods (SEPA, bank transfer) — only payment_status is reliable.
    const isPaid =
      session.payment_status === "paid"
      || session.payment_status === "no_payment_required";

    if (!isPaid) {
      await admin.from("photobook_orders").update({
        status: "payment_pending",
        payment_status: session.payment_status || "pending",
        stripe_payload: session,
        status_updated_at: now,
      }).eq("id", order.id);
      return json({ ok: true, pending: true });
    }

    await admin.from("photobook_orders").update({
      status: "paid",
      payment_status: "paid",
      stripe_checkout_session_id: session.id || order.stripe_checkout_session_id,
      stripe_payment_intent_id: session.payment_intent || order.stripe_payment_intent_id,
      stripe_payload: session,
      paid_at: order.paid_at || now,
      status_updated_at: now,
    }).eq("id", order.id);

    // Atomically claim fulfillment so concurrent or retried webhook deliveries
    // can never submit the same book to Peecho twice. NULL needs the explicit
    // is.null branch: NULL <> 'submitted' is not true in SQL.
    const { data: claimed, error: claimError } = await admin
      .from("photobook_orders")
      .update({ fulfillment_status: "submitting", status_updated_at: now })
      .eq("id", order.id)
      .or("fulfillment_status.is.null,fulfillment_status.in.(pending,failed,needs_configuration)")
      .select("id");

    if (claimError) {
      console.error("Fulfillment claim failed", claimError);
      return json({ error: "Fulfillment claim failed" }, 500);
    }
    if (!claimed || claimed.length === 0) {
      return json({ ok: true, alreadySubmitted: true });
    }

    try {
      const updatedOrder = { ...order, payment_status: "paid", stripe_payload: session, paid_at: order.paid_at || now };
      const fulfillment = await submitPeechoOrder(admin, updatedOrder, session);
      return json({ ok: true, fulfillment });
    } catch (submitError) {
      // Release the claim so a Stripe retry can attempt fulfillment again.
      await admin.from("photobook_orders").update({
        fulfillment_status: "failed",
        fulfillment_error: submitError instanceof Error ? submitError.message : "Peecho submit crashed",
        status_updated_at: new Date().toISOString(),
      }).eq("id", order.id);
      throw submitError;
    }
  } catch (error) {
    console.error("stripe-webhook error", error);
    return json({ error: error instanceof Error ? error.message : "Stripe webhook failed" }, 500);
  }
});
