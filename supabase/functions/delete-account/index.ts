import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPhotobookOrderTerminalForDeletion } from "../_shared/photobook.ts";

type AdminClient = ReturnType<typeof createClient<any>>;
const USER_STORAGE_BUCKETS = ["trip-media", "trip-private", "avatars", "photobook-pdfs"] as const;

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

const cleanupUserStorage = async (admin: AdminClient, userId: string) => {
  const failedBuckets: string[] = [];
  for (const bucket of USER_STORAGE_BUCKETS) {
    try {
      const allPaths = await collectStoragePaths(admin, bucket, userId);
      for (let index = 0; index < allPaths.length; index += 1000) {
        const { error: removeError } = await admin.storage
          .from(bucket)
          .remove(allPaths.slice(index, index + 1000));
        if (removeError) throw removeError;
      }
    } catch (error) {
      console.error(`Storage cleanup failed for ${bucket}:`, error);
      failedBuckets.push(bucket);
    }
  }
  return failedBuckets;
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

    const { error: lockError } = await admin.from("account_deletion_locks").insert({ user_id: userId });
    if (lockError) {
      console.error("Could not acquire account deletion lock", lockError);
      return json({
        error: "Accountverwijdering is al gestart of kon niet veilig worden vergrendeld. Probeer het later opnieuw.",
        code: "ACCOUNT_DELETION_LOCKED",
      }, 409);
    }

    try {
      const { data: orders, error: orderLookupError } = await admin
        .from("photobook_orders")
        .select("id, status, fulfillment_status, payment_status, stripe_checkout_session_id")
        .eq("user_id", userId);
      if (orderLookupError) {
        console.error("Could not verify active photobook orders", orderLookupError);
        return json({ error: "Je bestellingen konden niet worden gecontroleerd. Probeer het opnieuw." }, 500);
      }
      const activeOrders = (orders || []).filter((order) => !isPhotobookOrderTerminalForDeletion(order));
      if (activeOrders.length > 0) {
        return json({
          error: "Je account kan nog niet worden verwijderd omdat een Bouwboek-checkout of bestelling nog actief is. Annuleer de betaling of wacht tot de bestelling is afgerond.",
          code: "ACTIVE_PHOTOBOOK_ORDER",
        }, 409);
      }

      // Write the recovery record before the irreversible auth/database delete.
      // If any later storage operation fails, the cron already has every bucket
      // it needs and no post-delete queue insert can be lost.
      const { error: queuePrepareError } = await admin.from("account_deletion_cleanup_failures").upsert({
        user_id: userId,
        failed_buckets: [...USER_STORAGE_BUCKETS],
        attempts: 0,
        last_attempt_at: new Date().toISOString(),
        last_error: null,
      }, { onConflict: "user_id" });
      if (queuePrepareError) {
        console.error("Could not prepare durable account cleanup", queuePrepareError);
        return json({ error: "Accountverwijdering kon niet veilig worden voorbereid. Probeer het opnieuw." }, 500);
      }

      // Delete auth/database first. Storage is untouched if this transaction is
      // rejected (for example by the active-order database trigger).
      // The database trigger performs the final active-order check in the same
      // transaction as the cascading order deletion.
      const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
      if (deleteErr) {
        console.error("deleteUser failed", deleteErr);
        const { error: queueRollbackError } = await admin
          .from("account_deletion_cleanup_failures")
          .delete()
          .eq("user_id", userId);
        if (queueRollbackError) {
          // The cron verifies that the auth user is gone before deleting files,
          // so even a failed rollback cannot erase an active account's storage.
          console.error("Could not roll back prepared account cleanup", queueRollbackError);
        }
        return json({ error: "Account verwijderen mislukt" }, 500);
      }

      const storageFailures = await cleanupUserStorage(admin, userId);
      if (storageFailures.length > 0) {
        const { error: queueError } = await admin.from("account_deletion_cleanup_failures").update({
          failed_buckets: storageFailures,
          attempts: 1,
          last_attempt_at: new Date().toISOString(),
          last_error: "Storage cleanup failed after account deletion",
        }).eq("user_id", userId);
        if (queueError) {
          // The pre-created row still contains all buckets, so the cron can
          // recover even when narrowing the failure list fails.
          console.error("Could not update prepared post-delete cleanup", userId, queueError);
        }
        return json({
          ok: true,
          cleanupPending: true,
        }, 202);
      }

      const { error: queueResolveError } = await admin
        .from("account_deletion_cleanup_failures")
        .delete()
        .eq("user_id", userId);
      if (queueResolveError) {
        console.error("Could not resolve completed account cleanup", userId, queueResolveError);
        return json({ ok: true, cleanupPending: true }, 202);
      }

      return json({ ok: true });
    } finally {
      const { error: unlockError } = await admin
        .from("account_deletion_locks")
        .delete()
        .eq("user_id", userId);
      if (unlockError) console.error("Could not release account deletion lock", unlockError);
    }
  } catch (error) {
    console.error("delete-account error", error);
    return json({ error: error instanceof Error ? error.message : "Account verwijderen mislukt" }, 500);
  }
});
