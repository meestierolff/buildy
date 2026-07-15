import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertTrustedPeechoUrl,
  buildPhotobookCheckoutSnapshot,
  isPeechoFormat,
  isValidPeechoPageCount,
  photobookOrderMatchesQuote,
  type PeechoFormat,
} from "../_shared/photobook.ts";

type AdminClient = ReturnType<typeof createClient<any>>;

const PDF_BUCKET = "photobook-pdfs";
const MIN_PDF_BYTES = 1_000;
const DEFAULT_MAX_PDF_BYTES = 50 * 1024 * 1024;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 30 * 24 * 60 * 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getRequiredEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

const getRequiredNonNegativeInt = (key: string) => {
  const raw = getRequiredEnv(key);
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a non-negative integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${key} must be a safe non-negative integer`);
  return parsed;
};

const getRequiredPositiveInt = (key: string) => {
  const value = getRequiredNonNegativeInt(key);
  if (value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
};

const getCurrency = () => {
  const currency = (Deno.env.get("PHOTOBOOK_CURRENCY") || "eur").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new Error("PHOTOBOOK_CURRENCY must be a three-letter currency code");
  return currency;
};

const getSellerContactEmail = () => {
  const email = getRequiredEnv("SELLER_CONTACT_EMAIL");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("SELLER_CONTACT_EMAIL must be a valid email address");
  return email;
};

const getSellerContactPhone = () => {
  const phone = getRequiredEnv("SELLER_CONTACT_PHONE");
  if (!/^[+0-9][0-9 ()-]{5,30}$/.test(phone)) {
    throw new Error("SELLER_CONTACT_PHONE must be a valid public contact number");
  }
  return phone;
};

const getPositiveInt = (key: string, fallback: number) => {
  const parsed = Number.parseInt(Deno.env.get(key) || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getSiteUrl = () => {
  const raw = getRequiredEnv("SITE_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SITE_URL must be a valid absolute URL");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("SITE_URL must contain only the public origin");
  }
  const insecureDevAllowed = (Deno.env.get("ALLOW_INSECURE_CHECKOUT_URLS") || "").toLowerCase() === "true";
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(insecureDevAllowed && isLocalhost && url.protocol === "http:")) {
    throw new Error("SITE_URL must use HTTPS");
  }
  return url.origin;
};

const getAllowedShippingCountries = () => {
  const countries = (Deno.env.get("STRIPE_SHIPPING_COUNTRIES") || "")
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter((country) => /^[A-Z]{2}$/.test(country));
  if (countries.length === 0) throw new Error("STRIPE_SHIPPING_COUNTRIES is not configured");
  return countries;
};

const getOfferingId = (format: PeechoFormat) => {
  const formatSpecific = Deno.env.get(`PEECHO_OFFERING_ID_${format}`)?.trim();
  if (formatSpecific) return formatSpecific;
  // Backwards compatibility is safe only for the original A4 landscape format.
  if (format === "A4_LANDSCAPE") return Deno.env.get("PEECHO_OFFERING_ID")?.trim() || "";
  return "";
};

const assertLaunchConfiguration = (format: PeechoFormat) => {
  getRequiredEnv("STRIPE_SECRET_KEY");
  getSiteUrl();
  assertTrustedPeechoUrl(getRequiredEnv("PEECHO_ORDER_API_URL"));
  const paymentUrl = Deno.env.get("PEECHO_PAYMENT_API_URL")?.trim();
  if (paymentUrl) assertTrustedPeechoUrl(paymentUrl);
  getRequiredEnv("PEECHO_MERCHANT_API_KEY");
  getRequiredEnv("PEECHO_SECRET_KEY");
  if (!getOfferingId(format)) throw new Error(`PEECHO_OFFERING_ID_${format} is not configured`);
  if ((Deno.env.get("PHOTOBOOK_PRICES_INCLUDE_VAT") || "").toLowerCase() !== "true") {
    throw new Error("PHOTOBOOK_PRICES_INCLUDE_VAT must explicitly be true before checkout is enabled");
  }
  getRequiredNonNegativeInt("PHOTOBOOK_BASE_PRICE_CENTS");
  getRequiredNonNegativeInt("PHOTOBOOK_PRICE_PER_PAGE_CENTS");
  getRequiredNonNegativeInt("PHOTOBOOK_SHIPPING_PRICE_CENTS");
  getRequiredEnv("PHOTOBOOK_DELIVERY_ESTIMATE");
  getRequiredEnv("PHOTOBOOK_TERMS_VERSION");
  getRequiredEnv("SELLER_LEGAL_NAME");
  getSellerContactEmail();
  getSellerContactPhone();
  getRequiredEnv("SELLER_POSTAL_ADDRESS");
  getRequiredEnv("SELLER_REGISTRATION_NUMBER");
  if (getRequiredPositiveInt("PHOTOBOOK_ABANDONED_PDF_RETENTION_HOURS") < 25) {
    throw new Error("PHOTOBOOK_ABANDONED_PDF_RETENTION_HOURS must cover Stripe's 24-hour checkout window");
  }
  getRequiredPositiveInt("PHOTOBOOK_PAID_PDF_MAX_RETENTION_DAYS");
  getRequiredPositiveInt("PHOTOBOOK_PDF_COMPLAINT_RETENTION_DAYS");
  getAllowedShippingCountries();
};

const getAbandonedPdfDeleteAfter = () => {
  const retentionHours = getRequiredPositiveInt("PHOTOBOOK_ABANDONED_PDF_RETENTION_HOURS");
  if (retentionHours < 25) {
    throw new Error("PHOTOBOOK_ABANDONED_PDF_RETENTION_HOURS must cover Stripe's 24-hour checkout window");
  }
  return new Date(Date.now() + retentionHours * 60 * 60 * 1000).toISOString();
};

const getQuote = (pageCount: number) => {
  const baseCents = getRequiredNonNegativeInt("PHOTOBOOK_BASE_PRICE_CENTS");
  const pageCents = getRequiredNonNegativeInt("PHOTOBOOK_PRICE_PER_PAGE_CENTS");
  const shippingCents = getRequiredNonNegativeInt("PHOTOBOOK_SHIPPING_PRICE_CENTS");
  const subtotalCents = baseCents + pageCount * pageCents;
  return {
    baseCents,
    pageCents,
    shippingCents,
    subtotalCents,
    totalCents: subtotalCents + shippingCents,
    currency: getCurrency(),
    vatIncluded: true,
    shippingCountries: getAllowedShippingCountries(),
    deliveryEstimate: getRequiredEnv("PHOTOBOOK_DELIVERY_ESTIMATE"),
    termsVersion: getRequiredEnv("PHOTOBOOK_TERMS_VERSION"),
    seller: {
      legalName: getRequiredEnv("SELLER_LEGAL_NAME"),
      contactEmail: getSellerContactEmail(),
      contactPhone: getSellerContactPhone(),
      postalAddress: getRequiredEnv("SELLER_POSTAL_ADDRESS"),
      registrationNumber: getRequiredEnv("SELLER_REGISTRATION_NUMBER"),
    },
  };
};

const stripeRequest = async (
  path: string,
  init: RequestInit = {},
  idempotencyKey?: string,
) => {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getRequiredEnv("STRIPE_SECRET_KEY")}`);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const response = await fetch(`https://api.stripe.com/v1${path}`, { ...init, headers });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = data.error as Record<string, unknown> | undefined;
    throw new Error(String(error?.message || "Stripe verzoek mislukt"));
  }
  return data;
};

const countPdfPages = (bytes: Uint8Array) => {
  const pattern = new TextEncoder().encode("/Type /Page");
  let count = 0;
  for (let i = 0; i <= bytes.length - pattern.length; i += 1) {
    let matches = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (bytes[i + j] !== pattern[j]) {
        matches = false;
        break;
      }
    }
    if (matches && bytes[i + pattern.length] !== 0x73) count += 1; // exclude /Pages
  }
  return count;
};

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const validateStoredPdf = async (
  admin: AdminClient,
  path: string,
  declaredPageCount: number,
) => {
  const { data: blob, error } = await admin.storage.from(PDF_BUCKET).download(path);
  if (error || !blob) throw new Error("De geüploade PDF kon niet veilig worden gelezen");

  const maxBytes = getPositiveInt("PHOTOBOOK_MAX_PDF_BYTES", DEFAULT_MAX_PDF_BYTES);
  if (blob.size < MIN_PDF_BYTES) throw new Error("De PDF lijkt onvolledig");
  if (blob.size > maxBytes) throw new Error("De PDF is te groot om veilig te verwerken");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  const trailer = new TextDecoder().decode(bytes.slice(Math.max(0, bytes.length - 2048)));
  if (header !== "%PDF-" || !trailer.includes("%%EOF")) {
    throw new Error("Het geüploade bestand is geen geldige PDF");
  }

  const detectedPageCount = countPdfPages(bytes);
  if (detectedPageCount !== declaredPageCount || !isValidPeechoPageCount(detectedPageCount)) {
    throw new Error("Het pagina-aantal van de PDF komt niet overeen met de bestelling");
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { size: blob.size, pageCount: detectedPageCount, sha256: bytesToHex(new Uint8Array(digest)) };
};

const createSignedPdfUrl = async (admin: AdminClient, path: string) => {
  const ttl = getPositiveInt("PEECHO_PDF_SIGNED_URL_TTL_SECONDS", DEFAULT_SIGNED_URL_TTL_SECONDS);
  const { data, error } = await admin.storage.from(PDF_BUCKET).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) throw new Error("Kon geen beveiligde PDF-link voor de drukker maken");

  const response = await fetch(data.signedUrl, { headers: { Range: "bytes=0-4" } });
  if (!response.ok) throw new Error("De beveiligde PDF-link is niet bereikbaar voor de drukker");
  const reader = response.body?.getReader();
  const firstChunk = reader ? await reader.read() : null;
  await reader?.cancel();
  const header = new TextDecoder().decode((firstChunk?.value || new Uint8Array()).slice(0, 5));
  if (header !== "%PDF-") throw new Error("De beveiligde PDF-link levert geen geldige PDF");
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
};

const failCheckoutSetup = async (
  admin: AdminClient,
  order: { id: string; pdf_storage_path?: string | null },
  reason: "stripe_create_failed" | "checkout_persist_failed",
) => {
  const now = new Date().toISOString();
  const { data: failedRows, error: updateError } = await admin
    .from("photobook_orders")
    .update({
      status: "payment_failed",
      payment_status: "failed",
      pdf_delete_after: now,
      status_updated_at: now,
    })
    .eq("id", order.id)
    .neq("payment_status", "paid")
    .select("id");
  if (updateError) {
    console.error("Could not mark failed photobook checkout setup", order.id, updateError);
    return;
  }
  if (!failedRows?.length) return;

  if (order.pdf_storage_path) {
    const { error: removeError } = await admin.storage.from(PDF_BUCKET).remove([order.pdf_storage_path]);
    if (removeError) {
      console.error("Could not remove PDF after checkout setup failure", order.id, removeError);
    } else {
      await admin.from("photobook_orders").update({
        pdf_storage_path: null,
        pdf_url: "",
        pdf_url_expires_at: null,
        pdf_delete_after: null,
      }).eq("id", order.id);
    }
  }
  await admin.from("photobook_order_events").insert({
    order_id: order.id,
    event_type: "stripe_checkout_setup_failed",
    payload: { reason },
  });
};

const buildStripeParams = (
  order: Record<string, unknown>,
  quote: ReturnType<typeof getQuote>,
  customerEmail?: string,
) => {
  const siteUrl = getSiteUrl();
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("locale", "nl");
  params.set("submit_type", "pay");
  params.set("success_url", `${siteUrl}/bestelling/${order.id}?checkout=success`);
  params.set("cancel_url", `${siteUrl}/trip/${order.trip_id}/photobook?checkout=cancelled&order=${order.id}`);
  params.set("client_reference_id", String(order.id));
  params.set("customer_creation", "if_required");
  if (customerEmail) params.set("customer_email", customerEmail);
  params.set("billing_address_collection", "required");
  params.set("phone_number_collection[enabled]", "true");
  getAllowedShippingCountries().forEach((country, index) => {
    params.set(`shipping_address_collection[allowed_countries][${index}]`, country);
  });
  params.set("metadata[order_id]", String(order.id));
  params.set("metadata[trip_id]", String(order.trip_id));
  params.set("metadata[merchant_reference]", String(order.merchant_reference));
  // Refund webhooks carry PaymentIntent/Charge objects, not Checkout Session
  // metadata. Copy the immutable order identity onto the PaymentIntent too.
  params.set("payment_intent_data[metadata][order_id]", String(order.id));
  params.set("payment_intent_data[metadata][trip_id]", String(order.trip_id));
  params.set("payment_intent_data[metadata][merchant_reference]", String(order.merchant_reference));
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", quote.currency);
  params.set("line_items[0][price_data][unit_amount]", String(quote.subtotalCents));
  params.set("line_items[0][price_data][product_data][name]", "Buildy Bouwboek hardcover");
  params.set(
    "line_items[0][price_data][product_data][description]",
    `${order.page_count} pagina's, printklaar ${order.format}`,
  );
  params.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  params.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(quote.shippingCents));
  params.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", quote.currency);
  params.set("shipping_options[0][shipping_rate_data][display_name]", "Verzending Bouwboek");
  params.set("custom_text[submit][message]", "Dit is een gepersonaliseerd product dat na betaling direct voor productie wordt klaargezet.");

  if ((Deno.env.get("STRIPE_AUTOMATIC_TAX") || "").toLowerCase() === "true") {
    params.set("automatic_tax[enabled]", "true");
    params.set("line_items[0][price_data][tax_behavior]", "inclusive");
    params.set("shipping_options[0][shipping_rate_data][tax_behavior]", "inclusive");
  }
  return params;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnon = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const user = authData?.user;
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "checkout";
    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (action === "cancel") {
      const orderId = typeof body?.orderId === "string" ? body.orderId : "";
      if (!orderId) return json({ error: "orderId required" }, 400);
      const { data: order } = await admin.from("photobook_orders").select("*").eq("id", orderId).maybeSingle();
      if (!order || order.user_id !== user.id) return json({ error: "Order niet gevonden" }, 404);
      if (["paid", "partially_refunded", "refunded"].includes(order.payment_status)) {
        return json({ error: "Een verwerkte betaling kan hier niet worden geannuleerd" }, 409);
      }

      if (order.stripe_checkout_session_id) {
        const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(order.stripe_checkout_session_id)}`);
        if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
          return json({ error: "De betaling is al voltooid; de bestelling wordt verwerkt" }, 409);
        }
        // Delayed payment methods produce `complete` + `unpaid` while the bank
        // is still processing. Never delete the print source in that state.
        if (session.status === "complete") {
          return json({ error: "De betaling wordt nog verwerkt en kan nu niet worden geannuleerd" }, 409);
        }
        if (session.status === "open") {
          const expired = await stripeRequest(`/checkout/sessions/${encodeURIComponent(order.stripe_checkout_session_id)}/expire`, { method: "POST" });
          if (expired.status !== "expired") {
            return json({ error: "De betaling kon niet veilig worden geannuleerd" }, 409);
          }
        } else if (session.status !== "expired") {
          return json({ error: "De betaalstatus is nog niet definitief; probeer later opnieuw" }, 409);
        }
      }
      const { data: cancelledRows, error: cancelError } = await admin.from("photobook_orders").update({
        status: "payment_cancelled",
        payment_status: "cancelled",
        status_updated_at: new Date().toISOString(),
      }).eq("id", order.id).not("payment_status", "in", "(paid,partially_refunded,refunded)").select("id");
      if (cancelError) throw cancelError;
      if (!cancelledRows?.length) return json({ error: "De betaling is al verwerkt" }, 409);
      if (order.pdf_storage_path) {
        const { error: removeError } = await admin.storage.from(PDF_BUCKET).remove([order.pdf_storage_path]);
        if (removeError) {
          console.error("Could not remove cancelled photobook PDF", removeError);
        } else {
          await admin.from("photobook_orders").update({
            pdf_storage_path: null,
            pdf_url: "",
            pdf_url_expires_at: null,
            pdf_delete_after: null,
          }).eq("id", order.id);
        }
      }
      await admin.from("photobook_order_events").insert({
        order_id: order.id,
        event_type: "checkout_cancelled",
        payload: { source: "customer_return" },
      });
      return json({ ok: true });
    }

    const tripId = typeof body?.tripId === "string" ? body.tripId : "";
    const format = body?.format;
    const pageCount = body?.pageCount;
    if (!tripId || !isPeechoFormat(format) || !isValidPeechoPageCount(pageCount)) {
      return json({ error: "Ongeldige boekconfiguratie" }, 400);
    }

    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip || trip.user_id !== user.id) return json({ error: "Project niet gevonden" }, 404);

    const { data: deletionLock, error: deletionLockError } = await admin
      .from("account_deletion_locks")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (deletionLockError) throw deletionLockError;
    if (deletionLock) return json({ error: "Accountverwijdering is al gestart" }, 409);

    assertLaunchConfiguration(format);
    const quote = getQuote(pageCount);
    if (action === "quote") return json({ quote });
    if (
      body?.legalAccepted !== true
      || body?.acceptedTermsVersion !== quote.termsVersion
    ) {
      return json({ error: "Bevestig de actuele voorwaarden voordat je bestelt" }, 400);
    }

    const merchantReference = typeof body?.merchantReference === "string" ? body.merchantReference : "";
    const pdfPath = typeof body?.pdfPath === "string" ? body.pdfPath : "";
    const expectedPrefix = `buildy-${tripId}-`;
    if (
      !merchantReference.startsWith(expectedPrefix)
      || !/^[a-zA-Z0-9-]{20,160}$/.test(merchantReference)
      || pdfPath !== `${user.id}/${tripId}/${merchantReference}.pdf`
    ) {
      return json({ error: "Ongeldige PDF-referentie" }, 400);
    }

    const pdf = await validateStoredPdf(admin, pdfPath, pageCount);
    const signedPdf = await createSignedPdfUrl(admin, pdfPath);
    const now = new Date().toISOString();
    const checkoutSnapshot = buildPhotobookCheckoutSnapshot({
      quote,
      format,
      pageCount,
      acceptedAt: now,
    });

    let { data: order } = await admin
      .from("photobook_orders")
      .select("*")
      .eq("merchant_reference", merchantReference)
      .maybeSingle();

    if (order) {
      if (
        order.user_id !== user.id
        || order.trip_id !== tripId
        || order.pdf_sha256 !== pdf.sha256
        || order.page_count !== pageCount
        || order.format !== format
      ) {
        return json({ error: "Deze bestelreferentie is al in gebruik" }, 409);
      }
      if (order.payment_status === "paid") return json({ error: "Deze order is al betaald", orderId: order.id }, 409);
      if (!photobookOrderMatchesQuote(order, quote)) {
        return json({
          error: "Prijs of verkoopvoorwaarden zijn gewijzigd. Maak de bestelling opnieuw zodat je het actuele totaal kunt bevestigen.",
        }, 409);
      }
    } else {
      const insert = await admin.from("photobook_orders").insert({
        trip_id: tripId,
        user_id: user.id,
        merchant_reference: merchantReference,
        pdf_url: signedPdf.url,
        pdf_storage_path: pdfPath,
        pdf_sha256: pdf.sha256,
        pdf_size_bytes: pdf.size,
        pdf_url_expires_at: signedPdf.expiresAt,
        pdf_delete_after: getAbandonedPdfDeleteAfter(),
        format,
        page_count: pageCount,
        status: "pdf_ready",
        payment_status: "unpaid",
        payment_subtotal_cents: quote.subtotalCents,
        payment_shipping_cents: quote.shippingCents,
        payment_amount_cents: quote.totalCents,
        payment_currency: quote.currency,
        fulfillment_status: "not_started",
        legal_accepted_at: now,
        terms_version: quote.termsVersion,
        checkout_snapshot: checkoutSnapshot,
      }).select("*").single();
      if (insert.error || !insert.data) throw insert.error || new Error("Order kon niet worden aangemaakt");
      order = insert.data;
    }

    if (order.stripe_checkout_session_id) {
      const existingSession = await stripeRequest(`/checkout/sessions/${encodeURIComponent(order.stripe_checkout_session_id)}`);
      if (existingSession.status === "open" && existingSession.url) {
        return json({ checkoutUrl: existingSession.url, sessionId: existingSession.id, quote, order });
      }
      if (existingSession.payment_status === "paid") {
        return json({ error: "Deze order is al betaald", orderId: order.id }, 409);
      }
    }

    const params = buildStripeParams(order, quote, user.email);
    let session: Record<string, unknown>;
    try {
      session = await stripeRequest(
        "/checkout/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        },
        `photobook-checkout-${order.id}`,
      );
      if (!session.url || !session.id || session.status !== "open") {
        throw new Error("Stripe gaf geen actieve checkout-url terug");
      }
    } catch (stripeError) {
      await failCheckoutSetup(admin, order, "stripe_create_failed");
      throw stripeError;
    }

    const update = await admin.from("photobook_orders").update({
      status: "payment_pending",
      payment_status: "pending",
      stripe_checkout_session_id: session.id,
      status_updated_at: now,
    }).eq("id", order.id).select("*").single();
    if (update.error || !update.data) {
      try {
        await stripeRequest(`/checkout/sessions/${encodeURIComponent(String(session.id))}/expire`, { method: "POST" });
      } catch (expireError) {
        console.error("Could not expire unpersisted Stripe checkout session", session.id, expireError);
      }
      await failCheckoutSetup(admin, order, "checkout_persist_failed");
      throw update.error || new Error("Checkout kon niet worden opgeslagen");
    }

    await admin.from("photobook_order_events").insert({
      order_id: order.id,
      event_type: "stripe_checkout_created",
      payload: {
        session_id: session.id,
        subtotal_cents: quote.subtotalCents,
        shipping_cents: quote.shippingCents,
        total_cents: quote.totalCents,
        currency: quote.currency,
      },
    });

    return json({ checkoutUrl: session.url, sessionId: session.id, quote, order: update.data });
  } catch (error) {
    console.error("create-photobook-checkout error", error);
    return json({ error: error instanceof Error ? error.message : "Checkout starten mislukt" }, 500);
  }
});
