import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getSiteUrl = () =>
  (Deno.env.get("SITE_URL") || Deno.env.get("VITE_SITE_URL") || "http://127.0.0.1:8090").replace(/\/$/, "");

const getAllowedShippingCountries = () => {
  const raw = Deno.env.get("STRIPE_SHIPPING_COUNTRIES") || "NL,BE,DE";
  return raw
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
};

const createStripeCheckoutSession = async (params: URLSearchParams) => {
  const secretKey = getRequiredEnv("STRIPE_SECRET_KEY");
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    console.error("Stripe checkout session failed", response.status, data);
    throw new Error(data?.error?.message || "Stripe checkout kon niet worden gestart");
  }
  return data;
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
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authError } = await userClient.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (authError || !userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    if (!orderId) return json({ error: "orderId required" }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: order, error: orderError } = await admin
      .from("photobook_orders")
      .select("id, trip_id, user_id, merchant_reference, pdf_url, format, page_count, status, payment_status, stripe_checkout_session_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      console.error("Order lookup failed", orderError);
      return json({ error: "Order kon niet worden opgehaald" }, 500);
    }
    if (!order || order.user_id !== userId) return json({ error: "Order niet gevonden" }, 404);
    if (order.payment_status === "paid") return json({ error: "Deze order is al betaald" }, 409);

    const baseCents = toPositiveInt(Deno.env.get("PHOTOBOOK_BASE_PRICE_CENTS"), 1295);
    const pageCents = toPositiveInt(Deno.env.get("PHOTOBOOK_PRICE_PER_PAGE_CENTS"), 75);
    const currency = (Deno.env.get("PHOTOBOOK_CURRENCY") || "eur").toLowerCase();
    const amountCents = baseCents + Number(order.page_count) * pageCents;
    const siteUrl = getSiteUrl();
    const successUrl = `${siteUrl}/bestelling/${order.id}?checkout=success`;
    const cancelUrl = `${siteUrl}/trip/${order.trip_id}/photobook?checkout=cancelled&order=${order.id}`;

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);
    params.set("client_reference_id", order.id);
    params.set("customer_creation", "if_required");
    params.set("billing_address_collection", "required");
    params.set("phone_number_collection[enabled]", "true");
    params.set("shipping_address_collection[allowed_countries][0]", getAllowedShippingCountries()[0] || "NL");
    getAllowedShippingCountries().slice(1).forEach((country, index) => {
      params.set(`shipping_address_collection[allowed_countries][${index + 1}]`, country);
    });
    params.set("metadata[order_id]", order.id);
    params.set("metadata[trip_id]", order.trip_id);
    params.set("metadata[merchant_reference]", order.merchant_reference);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", currency);
    params.set("line_items[0][price_data][unit_amount]", String(amountCents));
    params.set("line_items[0][price_data][product_data][name]", "Buildy Bouwboek hardcover");
    params.set(
      "line_items[0][price_data][product_data][description]",
      `${order.page_count} pagina's, printklaar ${order.format}`,
    );
    if ((Deno.env.get("STRIPE_AUTOMATIC_TAX") || "").toLowerCase() === "true") {
      params.set("automatic_tax[enabled]", "true");
    }

    const session = await createStripeCheckoutSession(params);
    if (!session?.url || !session?.id) {
      console.error("Stripe session missing URL", session);
      return json({ error: "Stripe gaf geen checkout-url terug" }, 500);
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("photobook_orders")
      .update({
        status: "payment_pending",
        payment_status: "pending",
        payment_amount_cents: amountCents,
        payment_currency: currency,
        stripe_checkout_session_id: session.id,
        status_updated_at: now,
      })
      .eq("id", order.id);

    if (updateError) {
      console.error("Could not store Stripe checkout session", updateError);
      return json({ error: "Checkout kon niet worden opgeslagen" }, 500);
    }

    await admin.from("photobook_order_events").insert({
      order_id: order.id,
      event_type: "stripe_checkout_created",
      payload: {
        session_id: session.id,
        amount_cents: amountCents,
        currency,
      },
    });

    return json({
      checkoutUrl: session.url,
      sessionId: session.id,
      amountCents,
      currency,
    });
  } catch (error) {
    console.error("create-photobook-checkout error", error);
    return json({ error: error instanceof Error ? error.message : "Checkout starten mislukt" }, 500);
  }
});
