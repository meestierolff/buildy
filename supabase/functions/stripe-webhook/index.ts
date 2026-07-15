import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertTrustedPeechoUrl,
  buildMonotonicStripePaidUpdate,
  classifyStripeRefund,
  createAndPayPeechoOrder,
  FULFILLMENT_CLAIMABLE_STATUSES,
  FULFILLMENT_RETRYABLE_ORDER_STATUSES,
  getPeechoPaymentUrl,
  isPeechoFormat,
  normalizePeechoStatus,
  PEECHO_FORMATS,
  STRIPE_PHOTOBOOK_EVENT_TYPES,
  toPeechoCountryCode,
  validatePaidCheckoutSession,
  type PeechoFormat,
} from "../_shared/photobook.ts";

type AdminClient = ReturnType<typeof createClient<any>>;
type ProviderRecord = Record<string, any>;

const PDF_BUCKET = "photobook-pdfs";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 30 * 24 * 60 * 60;
const FULFILLMENT_LEASE_MINUTES = 15;
const SAFE_FULFILLMENT_ERROR = "De drukker kon de bestelling nog niet verwerken; automatische opvolging is nodig.";
const REFUND_EVENT_TYPES = new Set(["charge.refunded", "refund.created", "refund.updated"]);
const SAFE_REFUND_REVIEW = "De betaling is terugbetaald. Buildy controleert handmatig wat dit betekent voor productie en levering.";

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

const getRequiredPositiveInt = (key: string) => {
  const raw = getRequiredEnv(key);
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
};

const getPaidPdfDeleteAfter = () => new Date(
  Date.now() + getRequiredPositiveInt("PHOTOBOOK_PAID_PDF_MAX_RETENTION_DAYS") * 24 * 60 * 60 * 1000,
).toISOString();

const getRefundPdfDeleteAfter = () => {
  const parsed = Number.parseInt(Deno.env.get("PHOTOBOOK_PDF_COMPLAINT_RETENTION_DAYS") || "30", 10);
  const days = Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const providerId = (value: unknown) => {
  if (typeof value === "string" && value) return value;
  if (isRecord(value) && typeof value.id === "string" && value.id) return value.id;
  return null;
};

const stripeGet = async (path: string) => {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${getRequiredEnv("STRIPE_SECRET_KEY")}` },
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    // Never echo Stripe response bodies: they may contain customer details.
  }
  if (!response.ok) throw new Error(`Stripe object lookup failed (${response.status})`);
  return body;
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
  if (!signatureHeader) return false;
  const values = signatureHeader.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = values.find(([key]) => key === "t")?.[1];
  const signatures = values.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || signatures.length === 0) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = await hmacSha256Hex(getRequiredEnv("STRIPE_WEBHOOK_SECRET"), `${timestamp}.${body}`);
  return signatures.some((signature) => timingSafeEqual(expected, signature));
};

const normalizeOfferingId = (value: string) => (/^\d+$/.test(value) ? Number(value) : value);

const getOfferingId = (format: PeechoFormat) => {
  const formatSpecific = Deno.env.get(`PEECHO_OFFERING_ID_${format}`)?.trim();
  if (formatSpecific) return formatSpecific;
  if (format === "A4_LANDSCAPE") return Deno.env.get("PEECHO_OFFERING_ID")?.trim() || "";
  return "";
};

const splitName = (name: string | null | undefined) => {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Buildy", lastName: "Klant" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "." };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
};

const buildPeechoAddress = (session: Record<string, unknown>) => {
  const collected = (session.collected_information || {}) as Record<string, unknown>;
  const shipping = (collected.shipping_details || session.shipping_details || {}) as Record<string, unknown>;
  const customer = (session.customer_details || {}) as Record<string, unknown>;
  const address = (shipping.address || customer.address || {}) as Record<string, unknown>;
  const { firstName, lastName } = splitName(String(shipping.name || customer.name || ""));
  const result = {
    email_address: String(customer.email || session.customer_email || ""),
    shipping_address: {
      first_name: firstName,
      last_name: lastName,
      address_line_1: String(address.line1 || ""),
      address_line_2: String(address.line2 || ""),
      zip_code: String(address.postal_code || ""),
      city: String(address.city || ""),
      state: address.state ? String(address.state) : null,
      country_code: toPeechoCountryCode(address.country),
    },
  };
  const required = [
    result.email_address,
    result.shipping_address.first_name,
    result.shipping_address.address_line_1,
    result.shipping_address.zip_code,
    result.shipping_address.city,
    result.shipping_address.country_code,
  ];
  if (required.some((value) => !value)) throw new Error("Stripe leverde geen volledig verzendadres aan");
  return result;
};

const createFreshSignedPdfUrl = async (
  admin: AdminClient,
  storagePath: string,
) => {
  const configuredTtl = Number.parseInt(Deno.env.get("PEECHO_PDF_SIGNED_URL_TTL_SECONDS") || "", 10);
  const ttl = Number.isInteger(configuredTtl) && configuredTtl > 0
    ? configuredTtl
    : DEFAULT_SIGNED_URL_TTL_SECONDS;
  const { data, error } = await admin.storage.from(PDF_BUCKET).createSignedUrl(storagePath, ttl);
  if (error || !data?.signedUrl) throw new Error("Kon de beveiligde PDF niet voor Peecho vrijgeven");
  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
};

const getPeechoConfiguration = (format: PeechoFormat) => {
  const orderUrl = assertTrustedPeechoUrl(getRequiredEnv("PEECHO_ORDER_API_URL"));
  const merchantApiKey = getRequiredEnv("PEECHO_MERCHANT_API_KEY");
  const secretKey = getRequiredEnv("PEECHO_SECRET_KEY");
  const offeringId = getOfferingId(format);
  if (!offeringId) throw new Error(`PEECHO_OFFERING_ID_${format} is not configured`);
  return {
    orderUrl,
    paymentUrl: assertTrustedPeechoUrl(
      Deno.env.get("PEECHO_PAYMENT_API_URL")?.trim() || getPeechoPaymentUrl(orderUrl),
    ),
    merchantApiKey,
    secretKey,
    offeringId,
  };
};

const submitPeechoOrder = async (
  admin: AdminClient,
  order: ProviderRecord,
  session: Record<string, unknown>,
) => {
  if (!isPeechoFormat(order.format)) throw new Error("Onbekend Peecho-boekformaat");
  if (!order.pdf_storage_path) throw new Error("Beveiligd PDF-opslagpad ontbreekt");
  const config = getPeechoConfiguration(order.format);
  const dimensions = PEECHO_FORMATS[order.format];
  const signedPdf = await createFreshSignedPdfUrl(admin, String(order.pdf_storage_path));
  const addressDetails = buildPeechoAddress(session);

  await admin.from("photobook_orders").update({
    pdf_url: signedPdf.url,
    pdf_url_expires_at: signedPdf.expiresAt,
    customer_email: addressDetails.email_address,
    status_updated_at: new Date().toISOString(),
  }).eq("id", order.id);

  const createPayload = {
    merchant_api_key: config.merchantApiKey,
    order_reference: order.merchant_reference,
    purchase_order: order.merchant_reference,
    currency: String(order.payment_currency || "eur").toUpperCase(),
    item_details: [
      {
        item_reference: order.merchant_reference,
        offering_id: normalizeOfferingId(config.offeringId),
        quantity: 1,
        file_details: {
          content_url: signedPdf.url,
          content_width: dimensions.widthMm,
          content_height: dimensions.heightMm,
          number_of_pages: order.page_count,
        },
      },
    ],
    address_details: addressDetails,
  };

  const safeRequestSummary = {
    order_reference: order.merchant_reference,
    offering_id: normalizeOfferingId(config.offeringId),
    format: order.format,
    page_count: order.page_count,
    content_width_mm: dimensions.widthMm,
    content_height_mm: dimensions.heightMm,
  };

  const result = await createAndPayPeechoOrder({
    orderUrl: config.orderUrl,
    paymentUrl: config.paymentUrl,
    merchantApiKey: config.merchantApiKey,
    secretKey: config.secretKey,
    createPayload,
    existingPeechoId: order.peecho_id ? String(order.peecho_id) : null,
    onOrderCreated: async (peechoId, response) => {
      const now = new Date().toISOString();
      const update = await admin.from("photobook_orders").update({
        peecho_id: peechoId,
        status: "peecho_open",
        // Keep the lease while this invocation performs the separate Peecho
        // payment call. A crashed worker is recovered only after lease expiry.
        fulfillment_status: "submitting",
        fulfillment_error: null,
        peecho_payload: { create_status: "accepted", order_id: peechoId },
        peecho_order_request: safeRequestSummary,
        status_updated_at: now,
      }).eq("id", order.id);
      if (update.error) throw update.error;
      await admin.from("photobook_order_events").insert({
        order_id: order.id,
        event_type: "peecho_order_created",
        payload: { order_id: peechoId, accepted: true, response_state: response.order_state || null },
      });
    },
  });

  const normalized = normalizePeechoStatus(result.orderState);
  const now = new Date().toISOString();
  const update = await admin.from("photobook_orders").update({
    peecho_id: result.peechoId,
    status: normalized.status,
    fulfillment_status: normalized.fulfillmentStatus,
    fulfillment_error: null,
    fulfillment_claimed_at: null,
    peecho_payload: { payment_state: result.orderState, order_id: result.peechoId },
    peecho_order_request: safeRequestSummary,
    ordered_at: order.ordered_at || now,
    status_updated_at: now,
  }).eq("id", order.id);
  if (update.error) throw update.error;

  await admin.from("photobook_order_events").insert({
    order_id: order.id,
    event_type: "peecho_order_submitted",
    payload: { order_id: result.peechoId, order_state: result.orderState },
  });
  return { peechoId: result.peechoId, orderState: result.orderState };
};

const stripeEventSummary = (event: Record<string, unknown>, session: Record<string, unknown>) => ({
  stripe_event_id: event.id || null,
  stripe_event_type: event.type || null,
  session_id: session.id || null,
  payment_status: session.payment_status || null,
  amount_subtotal: session.amount_subtotal || null,
  amount_total: session.amount_total || null,
  currency: session.currency || null,
});

const processStripeRefund = async (
  admin: AdminClient,
  event: Record<string, unknown>,
  eventType: string,
  providerObject: Record<string, unknown>,
) => {
  if (
    eventType.startsWith("refund.")
    && providerObject.status
    && providerObject.status !== "succeeded"
  ) {
    return json({ ok: true, ignored: `refund ${String(providerObject.status)}` });
  }

  const refund = eventType.startsWith("refund.") ? providerObject : null;
  let charge = providerObject;
  if (eventType !== "charge.refunded") {
    const chargeId = providerId(refund?.charge);
    if (!chargeId) throw new Error("Stripe refund has no charge");
    charge = await stripeGet(`/charges/${encodeURIComponent(chargeId)}`);
  }
  const paymentIntentId = providerId(charge.payment_intent) || providerId(refund?.payment_intent);
  if (!paymentIntentId) throw new Error("Stripe refund has no payment intent");

  const paymentIntent = isRecord(charge.payment_intent)
    ? charge.payment_intent
    : await stripeGet(`/payment_intents/${encodeURIComponent(paymentIntentId)}`);
  const paymentIntentMetadata = isRecord(paymentIntent.metadata) ? paymentIntent.metadata : {};
  const chargeMetadata = isRecord(charge.metadata) ? charge.metadata : {};
  const refundMetadata = isRecord(refund?.metadata) ? refund.metadata : {};
  const metadata = { ...paymentIntentMetadata, ...chargeMetadata, ...refundMetadata };

  let order: ProviderRecord | null = null;
  const metadataOrderId = typeof metadata.order_id === "string" ? metadata.order_id : null;
  if (metadataOrderId) {
    const lookup = await admin.from("photobook_orders").select("*").eq("id", metadataOrderId).maybeSingle();
    if (lookup.error) throw lookup.error;
    order = lookup.data;
  }
  if (!order) {
    const lookup = await admin
      .from("photobook_orders")
      .select("*")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (lookup.error) throw lookup.error;
    order = lookup.data;
  }
  if (!order) return json({ error: "Refund order not found" }, 404);
  if (order.stripe_payment_intent_id && order.stripe_payment_intent_id !== paymentIntentId) {
    return json({ error: "Refund payment intent mismatch" }, 409);
  }

  const expectedCurrency = String(order.payment_currency || "").toLowerCase();
  const actualCurrency = String(charge.currency || refund?.currency || "").toLowerCase();
  const expectedTotal = Number(order.payment_amount_cents);
  const chargedTotal = Number(charge.amount);
  const amountRefunded = Number(charge.amount_refunded ?? refund?.amount);
  const refundKind = classifyStripeRefund({
    amountRefunded,
    expectedTotal,
    chargeFullyRefunded: charge.refunded,
  });
  if (
    !expectedCurrency
    || actualCurrency !== expectedCurrency
    || !Number.isSafeInteger(chargedTotal)
    || chargedTotal !== expectedTotal
    || refundKind === "review"
  ) {
    console.error("Stripe refund failed exact order validation", order.id, event.id);
    await admin.from("photobook_order_events").upsert({
      order_id: order.id,
      event_type: `stripe_${eventType}`,
      provider_event_id: event.id || null,
      payload: {
        stripe_event_id: event.id || null,
        stripe_event_type: eventType,
        payment_intent_id: paymentIntentId,
        validation: "manual_review",
      },
    }, { onConflict: "provider_event_id", ignoreDuplicates: true });
    const review = await admin.from("photobook_orders").update({
      status: "refund_review",
      fulfillment_status: "refund_review",
      fulfillment_error: SAFE_REFUND_REVIEW,
      fulfillment_claimed_at: null,
      status_updated_at: new Date().toISOString(),
    }).eq("id", order.id);
    if (review.error) throw review.error;
    return json({ error: "Refund requires manual review" }, 409);
  }

  const now = new Date().toISOString();
  const refundId = providerId(refund)
    || (isRecord(charge.refunds) && Array.isArray(charge.refunds.data)
      ? providerId(charge.refunds.data[0])
      : null);
  const eventWrite = await admin.from("photobook_order_events").upsert({
    order_id: order.id,
    event_type: `stripe_${eventType}`,
    provider_event_id: event.id || null,
    payload: {
      stripe_event_id: event.id || null,
      stripe_event_type: eventType,
      charge_id: providerId(charge),
      refund_id: refundId,
      payment_intent_id: paymentIntentId,
      amount_refunded: amountRefunded,
      currency: actualCurrency,
      refund_kind: refundKind,
    },
  }, { onConflict: "provider_event_id", ignoreDuplicates: true });
  if (eventWrite.error) throw eventWrite.error;

  // A Stripe refund is not proof that Peecho cancelled production. Keep the
  // fulfillment in explicit manual review; no Peecho cancellation call is made.
  const update = await admin.from("photobook_orders").update({
    status: refundKind === "full" ? "refunded" : "refund_review",
    payment_status: refundKind === "full" ? "refunded" : "partially_refunded",
    payment_refunded_cents: amountRefunded,
    stripe_payment_intent_id: paymentIntentId,
    stripe_refund_id: refundId,
    paid_at: order.paid_at || now,
    refunded_at: now,
    fulfillment_status: "refund_review",
    fulfillment_error: SAFE_REFUND_REVIEW,
    fulfillment_claimed_at: null,
    pdf_delete_after: getRefundPdfDeleteAfter(),
    status_updated_at: now,
  }).eq("id", order.id);
  if (update.error) throw update.error;
  return json({ ok: true, refund: refundKind });
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const rawBody = await req.text();
    if (!await verifyStripeSignature(rawBody, req.headers.get("Stripe-Signature"))) {
      return json({ error: "Invalid Stripe signature" }, 401);
    }

    const event = JSON.parse(rawBody) as Record<string, unknown>;
    if (typeof event.id !== "string" || !event.id) return json({ error: "Invalid Stripe event id" }, 400);
    const eventType = String(event.type || "");
    if (!STRIPE_PHOTOBOOK_EVENT_TYPES.has(eventType)) return json({ ok: true, ignored: "event type" });

    const eventData = (event.data || {}) as Record<string, unknown>;
    const providerObject = (eventData.object || {}) as Record<string, unknown>;

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    if (REFUND_EVENT_TYPES.has(eventType)) {
      return await processStripeRefund(admin, event, eventType, providerObject);
    }

    const session = providerObject;
    const metadata = (session.metadata || {}) as Record<string, unknown>;
    const orderId = metadata.order_id || session.client_reference_id;
    if (!orderId) return json({ ok: true, ignored: "missing order id" });

    const { data: order, error: orderError } = await admin
      .from("photobook_orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) {
      console.error("Order lookup failed for Stripe event", orderError, orderId);
      return json({ error: "Order not found" }, 404);
    }

    await admin.from("photobook_order_events").upsert({
      order_id: order.id,
      event_type: `stripe_${eventType}`,
      provider_event_id: event.id || null,
      payload: stripeEventSummary(event, session),
    }, { onConflict: "provider_event_id", ignoreDuplicates: true });

    const now = new Date().toISOString();
    const safeStripePayload = stripeEventSummary(event, session);
    const paymentAlreadyCaptured = ["paid", "partially_refunded", "refunded"]
      .includes(String(order.payment_status || ""));
    if (eventType === "checkout.session.expired") {
      if (!paymentAlreadyCaptured) {
        const { data: expiredRows, error: expireError } = await admin.from("photobook_orders").update({
          status: order.payment_status === "cancelled" ? "payment_cancelled" : "payment_expired",
          payment_status: order.payment_status === "cancelled" ? "cancelled" : "expired",
          fulfillment_claimed_at: null,
          stripe_payload: safeStripePayload,
          status_updated_at: now,
        }).eq("id", order.id).not("payment_status", "in", "(paid,partially_refunded,refunded)").select("id");
        if (expireError) throw expireError;
        if (expiredRows?.length && order.pdf_storage_path) {
          const { error: removeError } = await admin.storage.from(PDF_BUCKET).remove([order.pdf_storage_path]);
          if (removeError) {
            console.error("Could not remove expired photobook PDF", removeError);
          } else {
            await admin.from("photobook_orders").update({
              pdf_storage_path: null,
              pdf_url: "",
              pdf_url_expires_at: null,
              pdf_delete_after: null,
            }).eq("id", order.id);
          }
        }
      }
      return json({ ok: true });
    }

    if (eventType === "checkout.session.async_payment_failed") {
      const { data: failedRows, error: failedUpdateError } = await admin.from("photobook_orders").update({
        status: "payment_failed",
        payment_status: "failed",
        fulfillment_claimed_at: null,
        stripe_payload: safeStripePayload,
        status_updated_at: now,
      }).eq("id", order.id).not("payment_status", "in", "(paid,partially_refunded,refunded)").select("id");
      if (failedUpdateError) throw failedUpdateError;
      if (failedRows?.length && order.pdf_storage_path) {
        const { error: removeError } = await admin.storage.from(PDF_BUCKET).remove([order.pdf_storage_path]);
        if (removeError) {
          console.error("Could not remove failed-payment photobook PDF", removeError);
        } else {
          await admin.from("photobook_orders").update({
            pdf_storage_path: null,
            pdf_url: "",
            pdf_url_expires_at: null,
            pdf_delete_after: null,
          }).eq("id", order.id);
        }
      }
      return json({ ok: true });
    }

    const isPaid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
    if (!isPaid) {
      await admin.from("photobook_orders").update({
        status: "payment_pending",
        payment_status: String(session.payment_status || "pending"),
        stripe_payload: safeStripePayload,
        status_updated_at: now,
      }).eq("id", order.id).not("payment_status", "in", "(paid,partially_refunded,refunded)");
      return json({ ok: true, pending: true });
    }

    const validationError = validatePaidCheckoutSession(order, session);
    if (validationError) {
      console.error("Paid Stripe session failed order validation", validationError, order.id);
      await admin.from("photobook_orders").update({
        status: "payment_review",
        payment_status: "paid",
        fulfillment_status: "review",
        fulfillment_error: validationError,
        fulfillment_claimed_at: null,
        stripe_payload: safeStripePayload,
        paid_at: order.paid_at || now,
        status_updated_at: now,
      }).eq("id", order.id);
      return json({ error: "Paid session requires manual review" }, 409);
    }

    const totalDetails = (session.total_details || {}) as Record<string, unknown>;
    const actualTotal = Number(session.amount_total);
    const actualShipping = Number(totalDetails.amount_shipping);
    const customer = (session.customer_details || {}) as Record<string, unknown>;
    const paidUpdatePayload = buildMonotonicStripePaidUpdate({
      order,
      sessionId: session.id,
      paymentIntentId: session.payment_intent,
      totalCents: actualTotal,
      shippingCents: actualShipping,
      stripePayload: safeStripePayload,
      customerEmail: customer.email,
      pdfDeleteAfter: getPaidPdfDeleteAfter(),
      now,
    });
    const paidUpdate = await admin.from("photobook_orders").update(paidUpdatePayload).eq("id", order.id);
    if (paidUpdate.error) throw paidUpdate.error;

    // Includes `not_started`: that is the initial value written at checkout.
    let { data: claimed, error: claimError } = await admin
      .from("photobook_orders")
      .update({
        fulfillment_status: "submitting",
        fulfillment_error: null,
        fulfillment_claimed_at: now,
        status_updated_at: now,
      })
      .eq("id", order.id)
      .in("status", [...FULFILLMENT_RETRYABLE_ORDER_STATUSES])
      .or(`fulfillment_status.is.null,fulfillment_status.in.(${FULFILLMENT_CLAIMABLE_STATUSES.join(",")})`)
      .select("id");
    if (claimError) throw claimError;
    if (!claimed?.length) {
      // If an Edge runtime dies after claiming but before finishing, Stripe's
      // retry can safely take over the stale lease. The dedicated claim time is
      // rechecked by Postgres under the row lock, so only one retry wins.
      const staleBefore = new Date(Date.now() - FULFILLMENT_LEASE_MINUTES * 60 * 1000).toISOString();
      const staleClaim = await admin
        .from("photobook_orders")
        .update({
          fulfillment_status: "submitting",
          fulfillment_error: null,
          fulfillment_claimed_at: now,
          status_updated_at: now,
        })
        .eq("id", order.id)
        .in("status", [...FULFILLMENT_RETRYABLE_ORDER_STATUSES])
        .eq("fulfillment_status", "submitting")
        .or(`fulfillment_claimed_at.is.null,fulfillment_claimed_at.lt.${staleBefore}`)
        .select("id");
      claimed = staleClaim.data;
      claimError = staleClaim.error;
      if (claimError) throw claimError;
    }
    if (!claimed || claimed.length === 0) return json({ ok: true, alreadySubmitted: true });

    try {
      const updatedOrder = {
        ...order,
        payment_status: "paid",
        payment_amount_cents: Number.isFinite(actualTotal) ? actualTotal : order.payment_amount_cents,
        stripe_payload: safeStripePayload,
        paid_at: order.paid_at || now,
      };
      const fulfillment = await submitPeechoOrder(admin, updatedOrder, session);
      return json({ ok: true, fulfillment });
    } catch (submitError) {
      await admin.from("photobook_orders").update({
        status: "paid_pending_fulfillment",
        fulfillment_status: "failed",
        // Provider errors may echo request fields, including the temporary
        // signed PDF URL. Keep those details in restricted function logs only.
        fulfillment_error: SAFE_FULFILLMENT_ERROR,
        fulfillment_claimed_at: null,
        status_updated_at: new Date().toISOString(),
      }).eq("id", order.id);
      throw submitError;
    }
  } catch (error) {
    console.error("stripe-webhook error", error);
    return json({ error: error instanceof Error ? error.message : "Stripe webhook failed" }, 500);
  }
});
