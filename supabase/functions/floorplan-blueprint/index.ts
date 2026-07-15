// Edge function: turn an uploaded floorplan image into a clean blueprint style
// using Lovable AI (google/gemini-2.5-flash-image, aka Nano Banana).
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOwnedFloorplanSource } from "../_shared/floorplan-source.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BLUEPRINT_PROMPT = `Transform this floorplan into a clean architectural blueprint.
Style:
- Deep, saturated blueprint blue background (like classic cyanotype / engineering blueprint paper)
- Crisp thin white lines for all walls, doors, windows and furniture outlines
- Subtle white grid pattern overlay
- Hatched/cross-hatch patterns where appropriate (e.g. wall fills)
- Keep all rooms, walls, doors, windows and furniture in the exact same positions, proportions and dimensions as the input
- No colors other than blueprint blue and white
- No text labels unless they already exist in the input
- Top-down 2D view, no perspective, no shadows
- Output as a single high-resolution image`;

const GENERIC_ERROR = "Genereren mislukt. Probeer het opnieuw.";
const MAX_FLOORPLAN_BYTES = 30 * 1024 * 1024;

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const getDailyLimit = () => {
  const raw = Deno.env.get("AI_BLUEPRINT_DAILY_LIMIT")?.trim() || "";
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        Allow: "POST",
        "Content-Type": "application/json",
      },
    });
  }

  try {
    // Require authenticated user to prevent anonymous abuse of AI credits.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (authError || typeof userId !== "string" || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((Deno.env.get("AI_BLUEPRINT_ENABLED") || "").trim().toLowerCase() !== "true") {
      return json({ error: "AI-blauwdruk is momenteel niet beschikbaar." }, 503);
    }

    const dailyLimit = getDailyLimit();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!dailyLimit || !serviceRoleKey) {
      console.error("AI blueprint launch controls are not configured");
      return json({ error: "AI-blauwdruk is momenteel niet beschikbaar." }, 503);
    }

    const body = await req.json().catch(() => null);

    // Never let the AI gateway fetch an arbitrary user-controlled URL. Resolve
    // either a new private storage path or an owned legacy public storage URL,
    // then generate a fresh, short-lived URL from Supabase itself.
    const source = getOwnedFloorplanSource({
      imageUrl: body?.imageUrl,
      storagePath: body?.storagePath,
    }, userId);
    if (!source.ok) {
      return new Response(JSON.stringify({ error: source.error }), {
        status: source.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (source.tripId) {
      const { data: ownedTrip, error: tripError } = await supabase
        .from("trips")
        .select("id")
        .eq("id", source.tripId)
        .eq("user_id", userId)
        .maybeSingle();
      if (tripError || !ownedTrip) {
        return new Response(JSON.stringify({ error: "Geen toegang tot deze plattegrond." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: signedImage, error: signedImageError } = await supabase.storage
      .from(source.bucket)
      .createSignedUrl(source.objectPath, 60);
    if (signedImageError || !signedImage?.signedUrl) {
      console.error("Could not sign floorplan", signedImageError);
      return new Response(JSON.stringify({ error: "Plattegrond niet gevonden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sourceProbe = await fetch(signedImage.signedUrl, { method: "HEAD" });
    const contentType = sourceProbe.headers.get("content-type")?.toLowerCase() || "";
    const contentLength = Number(sourceProbe.headers.get("content-length"));
    if (!sourceProbe.ok) {
      return new Response(JSON.stringify({ error: "Plattegrond niet gevonden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (
      !contentType.startsWith("image/")
      || (Number.isFinite(contentLength) && contentLength > MAX_FLOORPLAN_BYTES)
    ) {
      return new Response(JSON.stringify({ error: "Kies een geldige afbeelding van maximaal 30 MB." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: quotaClaimed, error: quotaError } = await admin.rpc("claim_ai_blueprint_quota", {
      _user_id: userId,
      _daily_limit: dailyLimit,
    });
    if (quotaError) {
      console.error("AI blueprint quota claim failed", quotaError);
      return json({ error: "AI-blauwdruk is momenteel niet beschikbaar." }, 503);
    }
    if (!quotaClaimed) {
      return json({ error: "Je daglimiet voor AI-blauwdrukken is bereikt. Probeer het morgen opnieuw." }, 429);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({ error: GENERIC_ERROR }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: BLUEPRINT_PROMPT },
                {
                  type: "image_url",
                  image_url: { url: signedImage.signedUrl },
                },
              ],
            },
          ],
          modalities: ["image", "text"],
        }),
      },
    );

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Te veel verzoeken — probeer het zo opnieuw." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI-tegoed op. Voeg credits toe in Lovable Cloud." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const txt = await aiResp.text();
      console.error("AI gateway error", aiResp.status, txt);
      return new Response(JSON.stringify({ error: GENERIC_ERROR }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const imageDataUrl =
      data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageDataUrl) {
      console.error("No image returned", JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: GENERIC_ERROR }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ image: imageDataUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("blueprint error", e);
    return new Response(JSON.stringify({ error: GENERIC_ERROR }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
