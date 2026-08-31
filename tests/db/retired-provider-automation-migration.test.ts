// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0038_retire_automated_email.sql",
  import.meta.url,
);

describe("retired automated e-mail boundary", () => {
  it("removes every automatic producer while retaining historical records", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    for (const trigger of [
      "app_users_require_email_recipient_before_first_auth",
      "app_users_enqueue_welcome_email",
      "project_access_requests_enqueue_email",
      "deletion_jobs_enqueue_security_email",
      "photobook_order_events_enqueue_transactional_email",
    ]) {
      expect(migration).toContain(`DROP TRIGGER IF EXISTS ${trigger}`);
    }

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.app_suppress_retired_provider_outbox_event()");
    expect(migration).toContain("CREATE TRIGGER outbox_events_suppress_retired_provider_automation");
    expect(migration).toContain("NEW.event_type LIKE '%.email.%'");
    for (const eventType of [
      "lifecycle.welcome.requested.v1",
      "social.access_requested.requested.v1",
      "social.access_accepted.requested.v1",
      "security.account_alert.requested.v1",
      "migration.account.requested.v1",
      "moderation.report.received.requested.v1",
      "support.confirmation.requested.v1",
      "photobook_order.paid.v1",
    ]) {
      expect(migration).toContain(`'${eventType}'`);
    }

    expect(migration).not.toMatch(/DROP\s+(?:TABLE|FUNCTION)/i);
    expect(migration).not.toMatch(/DELETE\s+FROM|TRUNCATE/i);
  });
});
