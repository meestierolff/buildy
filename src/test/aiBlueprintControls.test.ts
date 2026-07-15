import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("AI blueprint launch controls", () => {
  it("fails closed and claims an atomic quota before calling the AI gateway", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/floorplan-blueprint/index.ts"),
      "utf8",
    );

    const authCheck = source.indexOf("supabase.auth.getClaims");
    const featureFlag = source.indexOf('Deno.env.get("AI_BLUEPRINT_ENABLED")');
    const quotaClaim = source.indexOf('admin.rpc("claim_ai_blueprint_quota"');
    const gatewayCall = source.indexOf('fetch(\n      "https://ai.gateway.lovable.dev');

    expect(authCheck).toBeGreaterThan(-1);
    expect(featureFlag).toBeGreaterThan(authCheck);
    expect(quotaClaim).toBeGreaterThan(featureFlag);
    expect(gatewayCall).toBeGreaterThan(quotaClaim);
  });

  it("keeps the quota counter service-role-only", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260715124500_ai_blueprint_controls.sql"),
      "utf8",
    );

    expect(migration).toContain("PRIMARY KEY (user_id, usage_date)");
    expect(migration).toContain("ON CONFLICT (user_id, usage_date) DO UPDATE");
    expect(migration).toContain("REVOKE ALL ON public.ai_blueprint_usage FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.claim_ai_blueprint_quota(uuid, integer) TO service_role");
  });
});
