import { ZodError } from "zod";
import { sql } from "drizzle-orm";
import { handleDefaultAuthRequest } from "../auth/http.js";
import { getCapabilities, getRuntimeConfig, getTrustedOrigins } from "../config/runtime.js";
import { getBuildyDatabase, getBuildyWorkerDatabase, type BuildyDatabase } from "../db/client.js";
import { HttpError } from "./errors.js";
import { assertTrustedMutationOrigin } from "./origin.js";
import { jsonError, jsonSuccess } from "./responses.js";
import { logEvent, safeErrorFields } from "../observability/logger.js";
import { handleDefaultProjectRequest } from "../projects/runtime.js";
import { handleDefaultMediaRequest } from "../media/runtime.js";
import { handleDefaultMediaCronRequest } from "../media/cron.js";
import { getServerCompositionStatus } from "../composition.js";
import { handleDefaultEmailCronRequest } from "../email/http.js";
import { handleDefaultBrevoWebhook } from "../email/brevoWebhook.js";
import { handleDefaultEngagementRequest } from "../engagement/runtime.js";
import { handleDefaultPlanningRequest } from "../planning/runtime.js";
import { handleDefaultSocialRequest } from "../social/runtime.js";
import { handleDefaultPhotobookCronRequest } from "../photobooks/cron.js";
import { handleDefaultPhotobookRequest } from "../photobooks/runtime.js";
import { handleDefaultProfileRequest } from "../profiles/runtime.js";
import { handleDefaultOrderRequest } from "../orders/runtime.js";
import { handleDefaultStripePaymentWebhook } from "../orders/paymentWebhookRuntime.js";
import { handleDefaultAccountRequest } from "../account/runtime.js";
import { handleDefaultAccountCronRequest } from "../account/cron.js";
import { handleDefaultPeechoFulfilmentCron } from "../fulfilment/cron.js";
import { handleDefaultPeechoCallback } from "../fulfilment/runtime.js";
import { handleDefaultModerationRequest } from "../moderation/runtime.js";
import { handleDefaultModerationAdminRequest } from "../moderation/adminRuntime.js";
import { handleDefaultBetaRequest } from "../beta/runtime.js";

type RouteHandler = (request: Request, requestId: string) => Response | Promise<Response>;
type PatternRouteHandler = (
  request: Request,
  requestId: string,
  parameters: Readonly<Record<string, string>>,
) => Response | Promise<Response>;

const routes = new Map<string, RouteHandler>();
const externalRoutes = new Map<string, RouteHandler>();
const prefixRoutes = new Map<string, RouteHandler>();
const patternRoutes: Array<{
  method: string;
  pattern: string;
  parameterNames: string[];
  expression: RegExp;
  handler: PatternRouteHandler;
}> = [];

function routeKey(method: string, pathname: string): string {
  return `${method.toUpperCase()} ${pathname.replace(/\/$/, "") || "/"}`;
}

export function registerRoute(method: string, pathname: string, handler: RouteHandler): void {
  const key = routeKey(method, pathname);
  if (routes.has(key) || externalRoutes.has(key)) throw new Error(`Route is al geregistreerd: ${key}`);
  routes.set(key, handler);
}

/** Provider callbacks authenticate inside their handler and do not send a browser Origin header. */
export function registerExternalRoute(method: string, pathname: string, handler: RouteHandler): void {
  const key = routeKey(method, pathname);
  if (routes.has(key) || externalRoutes.has(key)) throw new Error(`Route is al geregistreerd: ${key}`);
  externalRoutes.set(key, handler);
}

export function registerPrefixRoute(pathname: string, handler: RouteHandler): void {
  const prefix = pathname.replace(/\/$/, "") || "/";
  if (prefixRoutes.has(prefix)) throw new Error(`Routeprefix is al geregistreerd: ${prefix}`);
  prefixRoutes.set(prefix, handler);
}

export function registerPatternRoute(
  method: string,
  pattern: string,
  handler: PatternRouteHandler,
): void {
  const normalizedPattern = pattern.replace(/\/$/, "") || "/";
  if (patternRoutes.some((route) => route.method === method.toUpperCase() && route.pattern === normalizedPattern)) {
    throw new Error(`Routepatroon is al geregistreerd: ${method.toUpperCase()} ${normalizedPattern}`);
  }
  const parameterNames: string[] = [];
  const expressionParts = normalizedPattern.split("/").map((segment) => {
    if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parameterName = segment.slice(1);
    if (!/^[a-z][A-Za-z0-9]*$/.test(parameterName) || parameterNames.includes(parameterName)) {
      throw new Error(`Ongeldige routeparameter in ${normalizedPattern}.`);
    }
    parameterNames.push(parameterName);
    return "([^/]+)";
  });
  patternRoutes.push({
    method: method.toUpperCase(),
    pattern: normalizedPattern,
    parameterNames,
    expression: new RegExp(`^${expressionParts.join("/")}/?$`),
    handler,
  });
}

function findPatternHandler(
  method: string,
  pathname: string,
): { handler: PatternRouteHandler; parameters: Readonly<Record<string, string>> } | undefined {
  for (const route of patternRoutes) {
    if (route.method !== method.toUpperCase()) continue;
    const match = route.expression.exec(pathname);
    if (!match) continue;
    const parameters = Object.fromEntries(
      route.parameterNames.map((name, index) => [name, match[index + 1]]),
    );
    return { handler: route.handler, parameters };
  }
  return undefined;
}

function findPrefixHandler(pathname: string): RouteHandler | undefined {
  return [...prefixRoutes.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
}

async function workerHasNoTableDml(database: BuildyDatabase): Promise<boolean> {
  const result = await database.execute<{ isolated: boolean }>(sql`
    select not exists (
      select 1
      from information_schema.role_table_grants privilege
      where privilege.grantee = current_user
        and privilege.table_schema = 'public'
        and privilege.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ) as isolated
  `);
  return result.rows[0]?.isolated === true;
}

async function emailWorkerBoundaryReady(database: BuildyDatabase): Promise<boolean> {
  const result = await database.execute<{ ready: boolean }>(sql`
    select
      has_function_privilege(current_user, 'public.app_email_worker_claim(text,integer,integer)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_email_worker_prepare(uuid,text,text,text,text,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_email_worker_acknowledge(uuid,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_email_worker_complete(uuid,text,text,text,timestamptz)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_email_worker_fail(uuid,text,text,integer,boolean)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_reconcile_brevo_delivery_events(integer)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_email_worker_load_order(uuid,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_photobook_worker_claim(text,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_resolve_active_user(text)', 'EXECUTE')
      as ready
  `);
  return result.rows[0]?.ready === true && await workerHasNoTableDml(database);
}

async function mediaWorkerBoundaryReady(database: BuildyDatabase): Promise<boolean> {
  const result = await database.execute<{ ready: boolean }>(sql`
    select
      has_function_privilege(current_user, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_ack_outbox_event(text,uuid)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_retry_outbox_event(text,uuid,text,integer,boolean)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_begin_media_processing_job(text,uuid)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_finalize_media_processing_job(text,uuid,uuid,text,text,bigint,text,integer,integer,jsonb)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_fail_media_processing_job(text,uuid,uuid,text,integer,boolean)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_media_protected_object_keys(text[])', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_claim(text,integer,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_photobook_worker_claim(text,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_resolve_active_user(text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_order(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)', 'EXECUTE')
      as ready
  `);
  return result.rows[0]?.ready === true && await workerHasNoTableDml(database);
}

async function photobookWorkerBoundaryReady(database: BuildyDatabase): Promise<boolean> {
  const result = await database.execute<{ ready: boolean }>(sql`
    select
      has_function_privilege(current_user, 'public.app_photobook_worker_claim(text,integer)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_begin_photobook_render(text,uuid)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_finalize_photobook_render(text,uuid,uuid,text,bigint,integer,text,text,text,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_fail_photobook_render(text,uuid,uuid,text,integer,boolean)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_claim(text,integer,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_resolve_active_user(text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_order(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)', 'EXECUTE')
      as ready
  `);
  return result.rows[0]?.ready === true && await workerHasNoTableDml(database);
}

async function paymentWorkerBoundaryReady(database: BuildyDatabase): Promise<boolean> {
  const result = await database.execute<{ ready: boolean }>(sql`
    select
      has_function_privilege(
        current_user,
        'public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)',
        'EXECUTE'
      )
      and not has_function_privilege(current_user, 'public.app_resolve_active_user(text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_claim(text,integer,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_photobook_worker_claim(text,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_order(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)', 'EXECUTE')
      as ready
  `);
  return result.rows[0]?.ready === true && await workerHasNoTableDml(database);
}

async function fulfilmentWorkerBoundaryReady(database: BuildyDatabase): Promise<boolean> {
  const result = await database.execute<{ ready: boolean }>(sql`
    select
      has_function_privilege(current_user, 'public.app_peecho_worker_claim(text,text,integer)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_begin_peecho_fulfilment(text,uuid,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_begin_peecho_order_create(text,uuid,text,text,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_persist_peecho_order_created(text,uuid,text,text,text,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_begin_peecho_order_payment(text,uuid,text,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_finalize_peecho_order_status(text,uuid,text,text,text,text,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_retry_peecho_fulfilment(text,uuid,text,integer,boolean)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_mark_peecho_manual_review(text,uuid,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_record_peecho_callback(text,text,text,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_photobook_worker_claim(text,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_resolve_active_user(text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_order(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)', 'EXECUTE')
      as ready
  `);
  return result.rows[0]?.ready === true && await workerHasNoTableDml(database);
}

async function accountWorkerBoundaryReady(database: BuildyDatabase): Promise<boolean> {
  const result = await database.execute<{ ready: boolean }>(sql`
    select
      has_function_privilege(current_user, 'public.app_account_worker_claim_export(text,integer)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_begin_export(text,uuid)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_finalize_export(text,uuid,text,bigint,text)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_fail_export(text,uuid,text,integer,boolean)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_claim_expired_export(text,integer)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_finalize_export_cleanup(text,uuid)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_fail_export_cleanup(text,uuid,text,integer,boolean)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_claim_deletion(text,integer)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_begin_deletion(text,uuid)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_verify_deletion_asset(text,uuid,uuid)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_fail_deletion(text,uuid,uuid,text,integer,boolean)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_finalize_deletion(text,uuid)', 'EXECUTE')
      and has_function_privilege(current_user, 'public.app_account_worker_finalize_deletion_job(text,uuid)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_request_account_export(text,boolean,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_resolve_active_user(text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_order(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')
      and not has_function_privilege(current_user, 'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)', 'EXECUTE')
      as ready
  `);
  return result.rows[0]?.ready === true && await workerHasNoTableDml(database);
}

registerRoute("GET", "/api/health", (_request, requestId) => {
  const config = getRuntimeConfig();
  return jsonSuccess(
    {
      status: "ok" as const,
      environment: config.APP_ENV,
      release: config.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "development",
      capabilities: getCapabilities(config),
    },
    requestId,
  );
});

registerRoute("GET", "/api/readiness", async (_request, requestId) => {
  const config = getRuntimeConfig();
  const capabilities = getCapabilities(config);
  const configurationReady =
    capabilities.database === "ready" &&
    capabilities.authentication === "ready" &&
    getServerCompositionStatus() === "ready";
  let database: "pass" | "fail" | "not_checked" = "not_checked";
  let accountWorker: "pass" | "fail" | "not_checked" = "not_checked";
  let emailWorker: "pass" | "fail" | "not_checked" = "not_checked";
  let fulfilmentWorker: "pass" | "fail" | "not_checked" = "not_checked";
  let mediaWorker: "pass" | "fail" | "not_checked" = "not_checked";
  let paymentWorker: "pass" | "fail" | "not_checked" = "not_checked";
  let photobookWorker: "pass" | "fail" | "not_checked" = "not_checked";

  if (configurationReady && config.DATABASE_URL) {
    try {
      const result = await getBuildyDatabase(config.DATABASE_URL).execute<{ ready: boolean }>(sql`
        select
          row_security_active('public.projects'::regclass)
          and row_security_active('public.auth_identity_mappings'::regclass)
          and row_security_active('public.product_events'::regclass)
          and has_function_privilege(
            current_user,
            'public.app_resolve_active_user(text)',
            'EXECUTE'
          )
          and has_function_privilege(
            current_user,
            'public.app_provision_auth_identity(text,uuid,boolean)',
            'EXECUTE'
          )
          and has_function_privilege(
            current_user,
            'public.app_register_auth_email_recipient(text,text,text)',
            'EXECUTE'
          )
          and has_function_privilege(
            current_user,
            'public.app_enqueue_auth_email(uuid,text,text,jsonb)',
            'EXECUTE'
          )
          and has_function_privilege(
            current_user,
            'public.app_ingest_brevo_delivery_event(text,text,text,text,text,timestamptz)',
            'EXECUTE'
          )
          and has_function_privilege(current_user, 'public.app_users_are_blocked(uuid,uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_can_view_profile(uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_owns_project(uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_can_view_project(uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_can_view_update(uuid,uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_lock_social_user_pair(uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_enqueue_social_notification(uuid,text,uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_enqueue_engagement_notification(uuid,text,uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_set_social_access_email_preference(boolean)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_request_account_export(text,boolean,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_request_account_deletion(text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_request_project_deletion(uuid,integer,text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_replay_moderation_report(text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_submit_moderation_report(uuid,text,text,text,uuid,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_replay_feedback_submission(text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_submit_feedback_submission(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_moderation_target_hidden(text,uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_moderation_media_hidden(uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_resolve_moderation_actor(text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_admin_list_moderation_reports(text,text,text,timestamptz,uuid,integer)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_admin_load_moderation_report(uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_admin_list_moderation_actions(uuid)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_admin_apply_moderation_action(uuid,uuid,text,text,text,text,integer,uuid,text)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_migration_grant_role(uuid,uuid,text,text,text,timestamptz,timestamptz)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_migration_revoke_role(uuid,uuid,text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_reserve_beta_invite(text,text,text,text,text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_complete_beta_signup(text,text,text,text)', 'EXECUTE')
          and has_function_privilege(current_user, 'public.app_record_client_product_event(uuid,text,text,jsonb)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_create_beta_invite(uuid,text,text,integer,timestamptz,text,text)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_revoke_beta_invite(text,text)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_email_worker_claim(text,integer,integer)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_photobook_worker_claim(text,integer)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_email_worker_load_order(uuid,text)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)', 'EXECUTE')
          and not has_function_privilege(current_user, 'public.app_account_worker_claim_export(text,integer)', 'EXECUTE')
          as ready
      `);
      if (!result.rows[0]?.ready) {
        const boundaryError = new Error("Database-runtimegrens is niet least-privilege geconfigureerd.");
        Object.assign(boundaryError, { code: "DB_RUNTIME_BOUNDARY" });
        throw boundaryError;
      }
      database = "pass";
    } catch (error) {
      database = "fail";
      logEvent("error", "database.readiness_failed", { requestId, ...safeErrorFields(error) });
    }
  }

  if (capabilities.email === "ready" && config.DATABASE_EMAIL_WORKER_URL) {
    try {
      emailWorker = await emailWorkerBoundaryReady(
        getBuildyWorkerDatabase(config.DATABASE_EMAIL_WORKER_URL, "email"),
      ) ? "pass" : "fail";
    } catch (error) {
      emailWorker = "fail";
      logEvent("error", "database.email_worker_readiness_failed", {
        requestId,
        ...safeErrorFields(error),
      });
    }
  }

  if (capabilities.accountLifecycle === "ready" && config.DATABASE_ACCOUNT_WORKER_URL) {
    try {
      accountWorker = await accountWorkerBoundaryReady(
        getBuildyWorkerDatabase(config.DATABASE_ACCOUNT_WORKER_URL, "account"),
      ) ? "pass" : "fail";
    } catch (error) {
      accountWorker = "fail";
      logEvent("error", "database.account_worker_readiness_failed", {
        requestId,
        ...safeErrorFields(error),
      });
    }
  }

  if (capabilities.media === "ready" && config.DATABASE_MEDIA_WORKER_URL) {
    try {
      mediaWorker = await mediaWorkerBoundaryReady(
        getBuildyWorkerDatabase(config.DATABASE_MEDIA_WORKER_URL, "media"),
      ) ? "pass" : "fail";
    } catch (error) {
      mediaWorker = "fail";
      logEvent("error", "database.media_worker_readiness_failed", {
        requestId,
        ...safeErrorFields(error),
      });
    }
  }

  if (capabilities.photobooks === "ready" && config.DATABASE_PHOTOBOOK_WORKER_URL) {
    try {
      photobookWorker = await photobookWorkerBoundaryReady(
        getBuildyWorkerDatabase(config.DATABASE_PHOTOBOOK_WORKER_URL, "photobook"),
      ) ? "pass" : "fail";
    } catch (error) {
      photobookWorker = "fail";
      logEvent("error", "database.photobook_worker_readiness_failed", {
        requestId,
        ...safeErrorFields(error),
      });
    }
  }

  if (capabilities.payments === "ready" && config.DATABASE_PAYMENT_WORKER_URL) {
    try {
      paymentWorker = await paymentWorkerBoundaryReady(
        getBuildyWorkerDatabase(config.DATABASE_PAYMENT_WORKER_URL, "payment"),
      ) ? "pass" : "fail";
    } catch (error) {
      paymentWorker = "fail";
      logEvent("error", "database.payment_worker_readiness_failed", {
        requestId,
        ...safeErrorFields(error),
      });
    }
  }

  if (capabilities.printFulfilment === "ready" && config.DATABASE_FULFILMENT_WORKER_URL) {
    try {
      fulfilmentWorker = await fulfilmentWorkerBoundaryReady(
        getBuildyWorkerDatabase(config.DATABASE_FULFILMENT_WORKER_URL, "fulfilment"),
      ) ? "pass" : "fail";
    } catch (error) {
      fulfilmentWorker = "fail";
      logEvent("error", "database.fulfilment_worker_readiness_failed", {
        requestId,
        ...safeErrorFields(error),
      });
    }
  }

  const ready = configurationReady
    && database === "pass"
    && accountWorker !== "fail"
    && emailWorker !== "fail"
    && fulfilmentWorker !== "fail"
    && mediaWorker !== "fail"
    && paymentWorker !== "fail"
    && photobookWorker !== "fail";
  return jsonSuccess(
    {
      ready,
      checks: {
        configuration: configurationReady ? ("pass" as const) : ("fail" as const),
        database,
        accountWorker,
        emailWorker,
        fulfilmentWorker,
        mediaWorker,
        paymentWorker,
        photobookWorker,
      },
    },
    requestId,
    { status: ready ? 200 : 503 },
  );
});

registerPrefixRoute("/api/auth", handleDefaultAuthRequest);
registerRoute("GET", "/api/beta/status", handleDefaultBetaRequest);
registerRoute("POST", "/api/beta/reservations", handleDefaultBetaRequest);
registerRoute("POST", "/api/product-events", handleDefaultBetaRequest);
registerRoute("GET", "/api/internal/cron/email", handleDefaultEmailCronRequest);
registerRoute("GET", "/api/internal/cron/account-lifecycle", handleDefaultAccountCronRequest);
registerRoute("GET", "/api/internal/cron/media", handleDefaultMediaCronRequest);
registerRoute("GET", "/api/internal/cron/photobooks", handleDefaultPhotobookCronRequest);
registerRoute("GET", "/api/internal/cron/peecho-fulfilment", handleDefaultPeechoFulfilmentCron);
registerExternalRoute("POST", "/api/webhooks/brevo", handleDefaultBrevoWebhook);
registerExternalRoute("POST", "/api/webhooks/stripe", handleDefaultStripePaymentWebhook);
registerExternalRoute("POST", "/api/webhooks/peecho", handleDefaultPeechoCallback);
registerRoute("GET", "/api/projects", handleDefaultProjectRequest);
registerRoute("POST", "/api/projects", handleDefaultProjectRequest);
registerRoute("GET", "/api/discovery", handleDefaultProjectRequest);
registerRoute("GET", "/api/following", handleDefaultProjectRequest);
registerPatternRoute("GET", "/api/projects/:projectId", handleDefaultProjectRequest);
registerPatternRoute("PATCH", "/api/projects/:projectId", handleDefaultProjectRequest);
registerPatternRoute("DELETE", "/api/projects/:projectId", handleDefaultProjectRequest);
registerPatternRoute("GET", "/api/projects/:projectId/updates", handleDefaultProjectRequest);
registerPatternRoute("POST", "/api/projects/:projectId/updates", handleDefaultProjectRequest);
registerPatternRoute("PATCH", "/api/projects/:projectId/updates/:updateId", handleDefaultProjectRequest);
registerPatternRoute("DELETE", "/api/projects/:projectId/updates/:updateId", handleDefaultProjectRequest);
registerPatternRoute("POST", "/api/projects/:projectId/phases", handleDefaultProjectRequest);
registerRoute("POST", "/api/media/upload-intents", handleDefaultMediaRequest);
registerPatternRoute("POST", "/api/media/:assetId/complete", handleDefaultMediaRequest);
registerPatternRoute("POST", "/api/media/:assetId/original-grant", handleDefaultMediaRequest);
registerPatternRoute("GET", "/api/media/:assetId/original", handleDefaultMediaRequest);
registerPatternRoute("HEAD", "/api/media/:assetId/original", handleDefaultMediaRequest);
registerPatternRoute("GET", "/api/media/:assetId", handleDefaultMediaRequest);
registerPatternRoute("HEAD", "/api/media/:assetId", handleDefaultMediaRequest);
registerPrefixRoute("/api/social", handleDefaultSocialRequest);
registerRoute("GET", "/api/account/profile", handleDefaultProfileRequest);
registerRoute("PATCH", "/api/account/profile", handleDefaultProfileRequest);
registerRoute("GET", "/api/account/sessions", handleDefaultAccountRequest);
registerPatternRoute("DELETE", "/api/account/sessions/:sessionId", handleDefaultAccountRequest);
registerRoute("GET", "/api/account/exports", handleDefaultAccountRequest);
registerRoute("POST", "/api/account/exports", handleDefaultAccountRequest);
registerPatternRoute("GET", "/api/account/exports/:jobId/download", handleDefaultAccountRequest);
registerPatternRoute("HEAD", "/api/account/exports/:jobId/download", handleDefaultAccountRequest);
registerRoute("POST", "/api/account/deletion", handleDefaultAccountRequest);
registerPatternRoute("GET", "/api/profiles/:slug", handleDefaultProfileRequest);
registerPatternRoute("GET", "/api/projects/:projectId/updates/:updateId/comments", handleDefaultEngagementRequest);
registerPatternRoute("POST", "/api/projects/:projectId/updates/:updateId/comments", handleDefaultEngagementRequest);
registerPatternRoute("DELETE", "/api/projects/:projectId/updates/:updateId/comments/:commentId", handleDefaultEngagementRequest);
registerPatternRoute("GET", "/api/projects/:projectId/updates/:updateId/reactions", handleDefaultEngagementRequest);
registerPatternRoute("PUT", "/api/projects/:projectId/updates/:updateId/reactions", handleDefaultEngagementRequest);
registerPatternRoute("DELETE", "/api/projects/:projectId/updates/:updateId/reactions", handleDefaultEngagementRequest);
registerRoute("GET", "/api/notifications", handleDefaultEngagementRequest);
registerPatternRoute("PATCH", "/api/notifications/:notificationId", handleDefaultEngagementRequest);
registerPatternRoute("GET", "/api/projects/:projectId/floorplans", handleDefaultPlanningRequest);
registerPatternRoute("POST", "/api/projects/:projectId/floorplans", handleDefaultPlanningRequest);
registerPatternRoute("PATCH", "/api/projects/:projectId/floorplans/:floorplanId", handleDefaultPlanningRequest);
registerPatternRoute("DELETE", "/api/projects/:projectId/floorplans/:floorplanId", handleDefaultPlanningRequest);
registerPatternRoute("POST", "/api/projects/:projectId/floorplans/:floorplanId/pins", handleDefaultPlanningRequest);
registerPatternRoute("PATCH", "/api/projects/:projectId/floorplans/:floorplanId/pins/:pinId", handleDefaultPlanningRequest);
registerPatternRoute("DELETE", "/api/projects/:projectId/floorplans/:floorplanId/pins/:pinId", handleDefaultPlanningRequest);
registerPatternRoute("GET", "/api/projects/:projectId/budget", handleDefaultPlanningRequest);
registerPatternRoute("POST", "/api/projects/:projectId/budget", handleDefaultPlanningRequest);
registerPatternRoute("PATCH", "/api/projects/:projectId/budget", handleDefaultPlanningRequest);
registerPatternRoute("DELETE", "/api/projects/:projectId/budget", handleDefaultPlanningRequest);
registerPatternRoute("POST", "/api/projects/:projectId/budget/items", handleDefaultPlanningRequest);
registerPatternRoute("PATCH", "/api/projects/:projectId/budget/items/:itemId", handleDefaultPlanningRequest);
registerPatternRoute("DELETE", "/api/projects/:projectId/budget/items/:itemId", handleDefaultPlanningRequest);
registerPatternRoute("GET", "/api/projects/:projectId/photobook", handleDefaultPhotobookRequest);
registerPatternRoute("PUT", "/api/projects/:projectId/photobook/settings", handleDefaultPhotobookRequest);
registerPatternRoute("PUT", "/api/projects/:projectId/photobook/exclusions", handleDefaultPhotobookRequest);
registerPatternRoute("POST", "/api/projects/:projectId/photobook/proofs", handleDefaultPhotobookRequest);
registerPatternRoute("POST", "/api/photobooks/proofs/:revisionId/approve", handleDefaultPhotobookRequest);
registerPatternRoute("GET", "/api/photobooks/proofs/:revisionId/pdf", handleDefaultPhotobookRequest);
registerPatternRoute("HEAD", "/api/photobooks/proofs/:revisionId/pdf", handleDefaultPhotobookRequest);
registerPatternRoute("POST", "/api/photobooks/proofs/:revisionId/quote", handleDefaultOrderRequest);
registerPatternRoute("POST", "/api/photobooks/proofs/:revisionId/checkout", handleDefaultOrderRequest);
registerPatternRoute("GET", "/api/orders/:orderId", handleDefaultOrderRequest);
registerRoute("POST", "/api/moderation/reports", handleDefaultModerationRequest);
registerPrefixRoute("/api/moderation/admin", handleDefaultModerationAdminRequest);
registerRoute("POST", "/api/feedback", handleDefaultModerationRequest);
registerRoute("POST", "/api/support", handleDefaultModerationRequest);

export async function handleApiRequest(request: Request): Promise<Response> {
  const incomingRequestId = request.headers.get("x-request-id");
  const requestId = incomingRequestId && /^[0-9a-f-]{36}$/i.test(incomingRequestId)
    ? incomingRequestId
    : crypto.randomUUID();

  try {
    const url = new URL(request.url);
    const key = routeKey(request.method, url.pathname);
    const isExternalRoute = externalRoutes.has(key);
    const exactHandler = routes.get(key) ?? externalRoutes.get(key);
    const patternHandler = exactHandler ? undefined : findPatternHandler(request.method, url.pathname);
    const prefixHandler = exactHandler || patternHandler ? undefined : findPrefixHandler(url.pathname);
    if (!exactHandler && !patternHandler && !prefixHandler) {
      throw new HttpError(404, "NOT_FOUND", "Deze API-route bestaat niet.");
    }

    if (!isExternalRoute) assertTrustedMutationOrigin(request, getTrustedOrigins());
    if (exactHandler) return await exactHandler(request, requestId);
    if (patternHandler) {
      return await patternHandler.handler(request, requestId, patternHandler.parameters);
    }
    return await prefixHandler!(request, requestId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.code, error.message, requestId, error.fieldErrors);
    }

    if (error instanceof ZodError) {
      const fieldErrors = error.flatten().fieldErrors as Record<string, string[]>;
      return jsonError(400, "VALIDATION_FAILED", "De aanvraag bevat ongeldige gegevens.", requestId, fieldErrors);
    }

    logEvent("error", "http.unhandled_error", { requestId, ...safeErrorFields(error) });
    return jsonError(500, "INTERNAL_ERROR", "Er ging iets mis. Probeer het later opnieuw.", requestId);
  }
}
