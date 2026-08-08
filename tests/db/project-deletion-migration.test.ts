// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0020_project_deletion_saga.sql",
  import.meta.url,
);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Functie ${name} ontbreekt in de migratie.`);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  return migration.slice(start, next < 0 ? migration.length : next);
}

describe("project deletion saga migration", () => {
  it("keeps every project boundary behind fixed-path revoked SECURITY DEFINER functions", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const name of [
      "app_request_project_deletion",
      "app_project_worker_finalize_deletion",
      "app_account_worker_finalize_deletion_job",
    ]) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = pg_catalog, public");
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("binds requests to the owner, optimistic version and scoped idempotency key", async () => {
    const request = functionDefinition(
      await readFile(migrationUrl, "utf8"),
      "app_request_project_deletion",
    );

    expect(request).toContain("actor uuid := public.app_actor_id()");
    expect(request).toContain("project.owner_id = actor");
    expect(request).toContain("project.lifecycle_status = 'active'");
    expect(request).toContain("selected_project.version <> expected_project_version");
    expect(request).toContain("scoped_idempotency_key !~ '^project-command:v1:project[.]delete:[0-9a-f]{64}$'");
    expect(request).toContain("pg_advisory_xact_lock");
    expect(request).toContain("job.requested_by_id = actor");
    expect(request).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("blocks active physical orders at request and finalization time", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const request = functionDefinition(migration, "app_request_project_deletion");
    const finalize = functionDefinition(migration, "app_project_worker_finalize_deletion");

    for (const definition of [request, finalize]) {
      expect(definition).toContain("public.app_account_order_is_active(orders)");
      expect(definition).toContain("'blocked_active_order'");
    }
    expect(request).toContain("'project.deletion_blocked'");
    expect(finalize).toContain("RETURN 'blocked_active_order'");
  });

  it("freezes visibility and creates a deterministic manifest excluding ordered proofs", async () => {
    const request = functionDefinition(
      await readFile(migrationUrl, "utf8"),
      "app_request_project_deletion",
    );

    expect(request).toContain("INSERT INTO public.deletion_assets");
    expect(request).toContain("orders.proof_revision_id = revision.id");
    expect(request).toContain("revision.pdf_asset_id = asset.id");
    expect(request).toContain("string_agg(");
    expect(request).toContain("asset_manifest_sha256 = manifest_hash");
    expect(request).toContain("lifecycle_status = 'deletion_pending'");
    expect(request).toContain("visibility = 'private'");
    expect(request).toContain("status = 'dead_letter'");
    expect(request).toContain("'PROJECT_DELETION'");
  });

  it("claims account and project work with a bounded recoverable lease", async () => {
    const claim = functionDefinition(
      await readFile(migrationUrl, "utf8"),
      "app_account_worker_claim_deletion",
    );

    expect(claim).toContain("job.kind IN ('account', 'project')");
    expect(claim).toContain("project.lifecycle_status = 'deletion_pending'");
    expect(claim).toContain("account.status = 'deletion_pending'");
    expect(claim).toContain("FOR UPDATE OF job SKIP LOCKED");
    expect(claim).toContain("lease_seconds NOT BETWEEN 30 AND 900");
  });

  it("redacts content only after every object is verified while retaining ordered proof chains", async () => {
    const finalize = functionDefinition(
      await readFile(migrationUrl, "utf8"),
      "app_project_worker_finalize_deletion",
    );

    expect(finalize).toContain("asset.status <> 'verified'");
    expect(finalize).toMatch(/DELETE FROM public\.photobook_revisions[\s\S]*NOT EXISTS \([\s\S]*public\.photobook_orders/);
    expect(finalize).toContain("SET body = '[verwijderd]', status = 'deleted'");
    expect(finalize).toContain("SET phase_id = NULL, title = NULL, room = NULL, description = NULL");
    expect(finalize).toContain("DELETE FROM public.project_private_details");
    expect(finalize).toContain("title = 'Verwijderd project'");
    expect(finalize).toContain("lifecycle_status = 'deleted'");
    expect(finalize).toContain("'project.deletion_completed'");
  });

  it("dispatches finalization by server-owned job kind", async () => {
    const dispatcher = functionDefinition(
      await readFile(migrationUrl, "utf8"),
      "app_account_worker_finalize_deletion_job",
    );

    expect(dispatcher).toContain("job.lease_owner = worker_identifier");
    expect(dispatcher).toContain("selected_kind = 'account'");
    expect(dispatcher).toContain("public.app_account_worker_finalize_deletion(");
    expect(dispatcher).toContain("selected_kind = 'project'");
    expect(dispatcher).toContain("public.app_project_worker_finalize_deletion(");
  });

  it("wires only the request and dispatcher into their least-privilege runtimes", async () => {
    const [router, configure, verify] = await Promise.all([
      readFile(new URL("../../server/http/router.ts", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url), "utf8"),
    ]);

    expect(router).toContain('registerPatternRoute("DELETE", "/api/projects/:projectId"');
    expect(configure).toContain("public.app_request_project_deletion(uuid, integer, text, text)");
    expect(configure).toContain("public.app_account_worker_finalize_deletion_job(text, uuid)");
    expect(configure).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.app_project_worker_finalize_deletion/);
    expect(verify).toContain("public.app_project_worker_finalize_deletion(text,uuid)");
  });
});
