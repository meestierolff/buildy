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

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 1) Verwijder storage-bestanden in eigen prefix (trip-media + trip-private)
    for (const bucket of ["trip-media", "trip-private"]) {
      try {
        const { data: list } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
        if (list && list.length > 0) {
          const collectPaths = async (prefix: string): Promise<string[]> => {
            const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
            if (!data) return [];
            const paths: string[] = [];
            for (const item of data) {
              const full = `${prefix}/${item.name}`;
              if (item.id === null || item.metadata === null) {
                paths.push(...(await collectPaths(full)));
              } else {
                paths.push(full);
              }
            }
            return paths;
          };
          const allPaths = await collectPaths(userId);
          if (allPaths.length > 0) {
            await admin.storage.from(bucket).remove(allPaths);
          }
        }
      } catch (e) {
        console.error(`Storage cleanup failed for ${bucket}:`, e);
      }
    }

    // 2) Verwijder de auth-user — cascade FKs ruimen rest van public data op.
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error("deleteUser failed", deleteErr);
      return json({ error: "Account verwijderen mislukt" }, 500);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("delete-account error", error);
    return json({ error: error instanceof Error ? error.message : "Account verwijderen mislukt" }, 500);
  }
});
