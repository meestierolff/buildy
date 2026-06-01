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

const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const timingSafeEqual = (a: string, b: string) => {
  const left = new TextEncoder().encode(a.toLowerCase());
  const right = new TextEncoder().encode(b.toLowerCase());
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
};

const verifySignature = async (signature: string | null, orderId: string) => {
  const secretKey = Deno.env.get("PEECHO_SECRET_KEY");
  if (!secretKey) {
    console.error("PEECHO_SECRET_KEY is not configured");
    return false;
  }
  if (!signature) return false;

  const expected = await sha256Hex(`${secretKey}${orderId}`);
  return timingSafeEqual(signature, expected);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const merchantReference =
      body.order_reference
      || url.searchParams.get("order_reference")
      || url.searchParams.get("merchant_reference")
      || body.merchant_reference
      || body.reference;
    const peechoId =
      body.order_id
      || url.searchParams.get("order_id")
      || body.peecho_id
      || url.searchParams.get("peecho_id");
    const signature = body.signature || url.searchParams.get("signature") || null;

    if (!merchantReference || !peechoId) {
      return json({ error: "order_reference and order_id required" }, 400);
    }

    const valid = await verifySignature(String(signature || ""), String(peechoId));
    if (!valid) {
      return json({ error: "Invalid Peecho webhook signature" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase service credentials are not configured");
      return json({ error: "Webhook is not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const newStatus = body.new_status || body.status || "submitted_to_peecho";
    const now = new Date().toISOString();

    const { data: existing, error: selectError } = await supabase
      .from("photobook_orders")
      .select("id, ordered_at")
      .eq("merchant_reference", String(merchantReference))
      .maybeSingle();

    if (selectError) {
      console.error("Peecho order lookup failed", selectError);
      return json({ error: "Could not look up order" }, 500);
    }

    if (!existing) {
      return json({ error: "Order reference not found" }, 404);
    }

    const { data, error } = await supabase
      .from("photobook_orders")
      .update({
        peecho_id: String(peechoId),
        status: String(newStatus),
        ordered_at: existing.ordered_at ?? now,
        status_updated_at: now,
        tracking_code: body.tracking_code ?? null,
        tracking_url: body.tracking_url ?? null,
        peecho_payload: {
          event: Object.fromEntries(url.searchParams.entries()),
          body,
        },
      })
      .eq("id", existing.id)
      .select("id, status")
      .maybeSingle();

    if (error) {
      console.error("Peecho order update failed", error);
      return json({ error: "Could not update order" }, 500);
    }

    return json({ ok: true, order: data });
  } catch (error) {
    console.error("peecho-pingback error", error);
    return json({ error: "Pingback failed" }, 500);
  }
});
