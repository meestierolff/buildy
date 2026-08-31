// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0049_product_notifications.sql",
  import.meta.url,
);

function compact(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function functionDefinition(sql: string, name: string): string {
  const createMarker = `CREATE FUNCTION public.${name}(`;
  const replaceMarker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = Math.max(sql.lastIndexOf(createMarker), sql.lastIndexOf(replaceMarker));
  if (start < 0) throw new Error(`Ontbrekende functiedefinitie: ${name}`);
  const end = sql.indexOf("$function$;", start);
  if (end < 0) throw new Error(`Onvolledige functiedefinitie: ${name}`);
  return compact(sql.slice(start, end + "$function$;".length));
}

describe("product notification migration", () => {
  it("binds order notifications to a typed owner-only target and current RLS truth", async () => {
    const migration = compact(await readFile(migrationUrl, "utf8"));

    expect(migration).toContain("ADD COLUMN order_id uuid");
    expect(migration).toContain("FOREIGN KEY (order_id) REFERENCES public.photobook_orders(id) ON DELETE CASCADE");
    expect(migration).toContain("NEW.order_id IS DISTINCT FROM OLD.order_id");
    expect(migration).toContain(
      "CREATE FUNCTION public.app_can_view_notification_target( target_actor uuid, target_project uuid, target_update uuid, target_comment uuid, target_order uuid )",
    );
    expect(migration).toContain("orders.owner_id = public.app_actor_id()");
    expect(migration).toContain("owner_account.status = 'active'");
    expect(migration).toContain("owner_account.deleted_at IS NULL");
    expect(migration).toContain(
      "actor_id, project_id, update_id, comment_id, order_id",
    );
  });

  it("emits a first-publication notification only to eligible current profile followers", async () => {
    const source = await readFile(migrationUrl, "utf8");
    const migration = compact(source);
    const publication = functionDefinition(
      source,
      "app_enqueue_first_update_publication_notifications",
    );

    expect(publication).toContain(
      "IF TG_OP = 'UPDATE' AND OLD.status = 'published'::public.update_status THEN RETURN NEW",
    );
    expect(publication).toContain("profile_follow.kind = 'follow'");
    expect(publication).toContain("profile_follow.status = 'active'");
    expect(publication).toContain(
      "project.visibility IN ( 'public'::public.project_visibility, 'followers'::public.project_visibility )",
    );
    expect(publication).not.toMatch(/project\.visibility IN \([^)]*private/i);
    expect(publication).not.toMatch(/project\.visibility IN \([^)]*unlisted/i);
    expect(publication).toContain("recipient.status = 'active'");
    expect(publication).toContain("public.app_users_are_blocked(recipient.id, project.owner_id)");
    expect(publication).toContain("public.app_moderation_target_hidden('project', NEW.project_id)");
    expect(publication).toContain("public.app_moderation_target_hidden('update', NEW.id)");
    expect(migration).toContain("CREATE TRIGGER updates_enqueue_first_publication_notifications");
  });

  it("maps only relevant semantic order events and copies no event payload", async () => {
    const migration = compact(await readFile(migrationUrl, "utf8"));
    const requiredEvents = [
      "order.payment_succeeded.v1",
      "order.payment_failed.v1",
      "order.checkout_expired.v1",
      "order.checkout_reservation_expired.v1",
      "order.refund_recorded.v1",
      "order.payment_succeeded_manual_review.v1",
      "order.stripe_reconciliation_failed.v1",
      "order.refund_reconciliation_failed.v1",
      "order.refund_out_of_order.v1",
      "manual_fulfilment.ordered_manually.v1",
      "manual_fulfilment.mark_in_production.v1",
      "manual_fulfilment.mark_shipped.v1",
      "manual_fulfilment.mark_completed.v1",
      "manual_fulfilment.cancel.v1",
      "manual_fulfilment.refund_review.v1",
    ];
    for (const eventType of requiredEvents) expect(migration).toContain(eventType);

    expect(migration).not.toContain("order.payment_processing.v1' THEN");
    expect(migration).not.toContain("order.stripe_event_ignored.v1' THEN");
    expect(migration).toContain("jsonb_build_object('schemaVersion', 1)");
    expect(migration).not.toMatch(/jsonb_build_object\([^)]*(?:address|email|name|postcode)/i);
    expect(migration).toContain("'product.notification.created.v1'");
    expect(migration).toContain("CREATE UNIQUE INDEX notifications_update_published_recipient_uq");
    expect(migration).toContain("ON public.notifications(update_id, recipient_id, type)");
    expect(migration).toContain("WHERE type = 'update.published'");
    expect(migration).toContain("'product-notification:v2:' || gen_random_uuid()::text");
    expect(migration).toContain("'photobook-order-event:' || NEW.id::text");
    expect(migration).not.toContain("recipient.id::text");
    expect(migration).not.toContain("orders.owner_id::text");
    expect(migration).toContain("ON CONFLICT DO NOTHING");
    expect(migration).toContain("ON CONFLICT (dedupe_key) DO NOTHING");
    expect(migration).toContain("CREATE TRIGGER photobook_order_events_enqueue_product_notification");
  });

  it("replaces person-derived social dedupe hashes with typed exact-retry identity", async () => {
    const source = await readFile(migrationUrl, "utf8");
    const migration = compact(source);
    const social = functionDefinition(source, "app_enqueue_social_notification");
    const engagement = functionDefinition(source, "app_enqueue_engagement_notification");

    expect(migration).toContain(
      "ADD COLUMN source_aggregate_id uuid, ADD COLUMN source_version integer, ADD COLUMN source_occurred_at timestamptz",
    );
    expect(migration).toContain(
      "WHERE dedupe_key LIKE 'social-notification:v1:%' OR dedupe_key LIKE 'engagement-notification:v1:%'",
    );
    expect(migration).toContain("SET dedupe_key = NULL, updated_at = statement_timestamp()");
    expect(migration).toContain("CREATE UNIQUE INDEX notifications_social_version_recipient_uq");
    expect(migration).toContain("CREATE UNIQUE INDEX notifications_project_follow_event_recipient_uq");
    expect(migration).toContain("CREATE UNIQUE INDEX notifications_engagement_source_recipient_uq");
    expect(migration).toContain("NEW.source_aggregate_id IS DISTINCT FROM OLD.source_aggregate_id");
    expect(migration).toContain("NEW.source_version IS DISTINCT FROM OLD.source_version");
    expect(migration).toContain("NEW.source_occurred_at IS DISTINCT FROM OLD.source_occurred_at");

    expect(social).toContain("'social-notification:v2:' || gen_random_uuid()::text");
    expect(social).toContain("relationship.id, relationship.version");
    expect(social).toContain("source_aggregate_id, source_version, source_occurred_at");
    expect(social).toContain("ON CONFLICT DO NOTHING");
    expect(social).not.toContain("digest(");
    expect(social).not.toContain("notification_recipient::text");
    expect(social).not.toContain("actor_user::text");

    expect(engagement).toContain("'engagement-notification:v2:' || gen_random_uuid()::text");
    expect(engagement).toContain("source_aggregate_id");
    expect(engagement).toContain("ON CONFLICT DO NOTHING");
    expect(engagement).not.toContain("digest(");
    expect(engagement).not.toContain("notification_recipient::text");
    expect(engagement).not.toContain("actor_user::text");
  });

  it("keeps the five-argument read helper grant fail-closed and inventoried", async () => {
    const [configure, verifyRoles, readiness, databaseVerify] = await Promise.all([
      readFile(new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../server/http/router.ts", import.meta.url), "utf8"),
      readFile(new URL("../../db/verify.ts", import.meta.url), "utf8"),
    ]);

    for (const source of [configure, verifyRoles, readiness]) {
      const normalized = source.replace(/\s+/g, "");
      expect(normalized).toContain("app_can_view_notification_target(uuid,uuid,uuid,uuid,uuid)");
      expect(normalized).toContain("app_enqueue_social_notification(uuid,text,uuid)");
      expect(normalized).toContain("app_enqueue_engagement_notification(uuid,text,uuid)");
      expect(normalized).not.toContain("app_can_view_notification_target(uuid,uuid,uuid,uuid)'");
    }
    expect(databaseVerify).toContain('"app_enqueue_first_update_publication_notifications"');
    expect(databaseVerify).toContain('"app_enqueue_photobook_order_event_notification"');
    expect(databaseVerify).toContain('"app_enqueue_social_notification"');
    expect(databaseVerify).toContain('"app_enqueue_engagement_notification"');
    expect(databaseVerify).toContain('"updates_enqueue_first_publication_notifications"');
    expect(databaseVerify).toContain('"photobook_order_events_enqueue_product_notification"');
  });

  it("selects and maps the typed order target without exposing a raw payload", async () => {
    const [schema, repository, contract] = await Promise.all([
      readFile(new URL("../../db/schema/social.ts", import.meta.url), "utf8"),
      readFile(new URL("../../server/engagement/repository.ts", import.meta.url), "utf8"),
      readFile(new URL("../../shared/contracts/engagement.ts", import.meta.url), "utf8"),
    ]);
    const compactRepository = compact(repository);

    expect(schema).toContain('orderId: uuid("order_id")');
    expect(schema).toContain('sourceAggregateId: uuid("source_aggregate_id")');
    expect(schema).toContain('sourceVersion: integer("source_version")');
    expect(schema).toContain('sourceOccurredAt: timestamp("source_occurred_at"');
    expect(compactRepository).toContain("notification.order_id");
    expect(compactRepository).toContain("orderId: row.order_id");
    expect(compactRepository).toContain(
      "notification.actor_id, notification.project_id, notification.update_id, notification.comment_id, notification.order_id",
    );
    expect(repository.match(/canonicalNotificationFilter/g)?.length).toBeGreaterThanOrEqual(4);
    expect(contract).toContain("orderId: uuidSchema.nullable()");
    expect(contract).not.toMatch(/engagementNotificationSchema[\s\S]{0,600}payload:/);
  });
});
