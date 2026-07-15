#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const loadPaged = async (table, columns) => {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
};

const loadAuthUserIds = async () => {
  const ids = new Set();
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`auth.users: ${error.message}`);
    data.users.forEach((user) => ids.add(user.id));
    if (data.users.length < perPage) return ids;
  }
};

let authUserIds;
let trips;
let steps;
let follows;
let userFollows;
let reactions;
let comments;
let notifications;

try {
  [authUserIds, trips, steps, follows, userFollows, reactions, comments, notifications] = await Promise.all([
    loadAuthUserIds(),
    loadPaged("trips", "id"),
    loadPaged("steps", "id"),
    loadPaged("follows", "id, project_id, user_id"),
    loadPaged("user_follows", "id, follower_id, following_id"),
    loadPaged("reactions", "id, step_id, user_id"),
    loadPaged("comments", "id, parent_id"),
    loadPaged("notifications", "id, user_id, actor_id, project_id, step_id"),
  ]);
} catch (error) {
  console.error(`Social integrity audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const tripIds = new Set(trips.map((row) => row.id));
const stepIds = new Set(steps.map((row) => row.id));
const commentIds = new Set(comments.map((row) => row.id));
const missing = (value, ids) => value != null && !ids.has(value);

const checks = [
  { constraint: "follows_project_id_fkey", rows: follows.filter((row) => missing(row.project_id, tripIds)) },
  { constraint: "follows_user_id_fkey", rows: follows.filter((row) => missing(row.user_id, authUserIds)) },
  { constraint: "user_follows_follower_id_fkey", rows: userFollows.filter((row) => missing(row.follower_id, authUserIds)) },
  { constraint: "user_follows_following_id_fkey", rows: userFollows.filter((row) => missing(row.following_id, authUserIds)) },
  { constraint: "reactions_step_id_fkey", rows: reactions.filter((row) => missing(row.step_id, stepIds)) },
  { constraint: "reactions_user_id_fkey", rows: reactions.filter((row) => missing(row.user_id, authUserIds)) },
  { constraint: "comments_parent_id_fkey", rows: comments.filter((row) => missing(row.parent_id, commentIds)) },
  { constraint: "notifications_user_id_fkey", rows: notifications.filter((row) => missing(row.user_id, authUserIds)) },
  { constraint: "notifications_actor_id_fkey", rows: notifications.filter((row) => missing(row.actor_id, authUserIds)) },
  { constraint: "notifications_project_id_fkey", rows: notifications.filter((row) => missing(row.project_id, tripIds)) },
  { constraint: "notifications_step_id_fkey", rows: notifications.filter((row) => missing(row.step_id, stepIds)) },
];

const report = checks.map((check) => ({
  constraint: check.constraint,
  orphan_count: check.rows.length,
  example_row_ids: check.rows.slice(0, 5).map((row) => row.id).join(", "),
}));
console.table(report);

const totalOrphans = checks.reduce((sum, check) => sum + check.rows.length, 0);
if (totalOrphans > 0) {
  console.error(`NO-GO: ${totalOrphans} orphan relationship(s) found. Review and repair them; this script never mutates data.`);
  process.exit(1);
}

console.log("PASS: no legacy social-integrity orphans found. The listed constraints may now be VALIDATEd.");
