#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicMarkers = [
  "/storage/v1/object/public/trip-media/",
  "/storage/v1/render/image/public/trip-media/",
];
const avatarMarkers = [
  "/storage/v1/object/public/avatars/",
  "/storage/v1/render/image/public/avatars/",
];
const MAX_EXAMPLES = 25;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const publicBucketPath = (value, markers) => {
  if (typeof value !== "string") return null;
  const marker = markers.find((candidate) => value.includes(candidate));
  if (!marker) return null;
  const encodedPath = value.slice(value.indexOf(marker) + marker.length).split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
};
const publicObjectPath = (value) => publicBucketPath(value, publicMarkers);
const publicAvatarPath = (value) => publicBucketPath(value, avatarMarkers);

const loadPaged = async (makeQuery, label) => {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
};

const collectBucketObjects = async (bucket, prefix = "") => {
  const paths = [];
  const folders = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`${bucket}/${prefix || "<root>"}: ${error.message}`);
    for (const item of data || []) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id == null) folders.push(fullPath);
      else if (item.name !== ".emptyFolderPlaceholder") paths.push(fullPath);
    }
    if (!data || data.length < pageSize) break;
  }
  for (const folder of folders) paths.push(...await collectBucketObjects(bucket, folder));
  return paths;
};

let trips;
let steps;
let mediaRows;
let profiles;
try {
  [trips, steps, mediaRows, profiles] = await Promise.all([
    loadPaged(
      () => supabase
        .from("trips")
        .select("id, user_id, is_public, cover_image_url, floorplan_url, floorplans")
        .order("id"),
      "trips",
    ),
    loadPaged(
      () => supabase.from("steps").select("id, trip_id").order("id"),
      "steps",
    ),
    loadPaged(
      () => supabase.from("step_media").select("id, step_id, media_url, storage_path").order("id"),
      "step media",
    ),
    loadPaged(
      () => supabase.from("profiles").select("id, user_id, avatar_url").order("id"),
      "profiles",
    ),
  ]);
} catch (error) {
  console.error(`Private asset inventory failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const findings = [];
for (const trip of trips) {
  const coverPath = publicObjectPath(trip.cover_image_url);
  if (coverPath) findings.push({ trip_id: trip.id, user_id: trip.user_id, visibility: trip.is_public ? "public" : "private", field: "cover_image_url", object_path: coverPath });

  const floorplanPath = publicObjectPath(trip.floorplan_url);
  if (floorplanPath) findings.push({ trip_id: trip.id, user_id: trip.user_id, visibility: trip.is_public ? "public" : "private", field: "floorplan_url", object_path: floorplanPath });

  if (Array.isArray(trip.floorplans)) {
    trip.floorplans.forEach((floor, index) => {
      const path = publicObjectPath(floor?.url);
      if (path) findings.push({ trip_id: trip.id, user_id: trip.user_id, visibility: trip.is_public ? "public" : "private", field: `floorplans[${index}].url`, object_path: path });
    });
  }
}

const userIdByTripId = new Map(trips.map((trip) => [trip.id, trip.user_id]));
const visibilityByTripId = new Map(trips.map((trip) => [trip.id, trip.is_public ? "public" : "private"]));
const tripIdByStepId = new Map(steps.map((step) => [step.id, step.trip_id]));
for (const media of mediaRows) {
  const tripId = tripIdByStepId.get(media.step_id);
  if (!tripId) continue;
  const path = publicObjectPath(media.media_url);
  if (!path) continue;
  findings.push({
    trip_id: tripId,
    user_id: userIdByTripId.get(tripId),
    visibility: visibilityByTripId.get(tripId),
    field: `step_media[${media.id}].media_url`,
    object_path: path,
  });
}

// Build a complete reference set before listing the bucket. Profile avatars
// are intentionally included because they also live in trip-media today.
const referencedPublicPaths = new Set();
const rememberReference = (value) => {
  const path = publicObjectPath(value);
  if (path) referencedPublicPaths.add(path);
};
for (const trip of trips) {
  rememberReference(trip.cover_image_url);
  rememberReference(trip.floorplan_url);
  if (Array.isArray(trip.floorplans)) {
    trip.floorplans.forEach((floor) => rememberReference(floor?.url));
  }
}
mediaRows.forEach((media) => rememberReference(media.media_url));
profiles.forEach((profile) => rememberReference(profile.avatar_url));

const referencedAvatarPaths = new Set();
const invalidAvatarReferences = [];
profiles.forEach((profile) => {
  const path = publicAvatarPath(profile.avatar_url);
  if (!path) return;
  referencedAvatarPaths.add(path);
  const segments = path.split("/");
  if (segments.length !== 2
    || segments[0] !== profile.user_id
    || !/^avatar-[ab]\.(jpe?g|png|webp|gif)$/i.test(segments[1])) {
    invalidAvatarReferences.push({ profile_user_id: profile.user_id, object_path: path });
  }
});

let publicObjects;
let avatarObjects;
try {
  [publicObjects, avatarObjects] = await Promise.all([
    collectBucketObjects("trip-media"),
    collectBucketObjects("avatars"),
  ]);
} catch (error) {
  console.error(`Public bucket inventory failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const publicObjectSet = new Set(publicObjects);
const avatarObjectSet = new Set(avatarObjects);
const orphanObjects = publicObjects.filter((path) => !referencedPublicPaths.has(path));
const missingReferences = [...referencedPublicPaths].filter((path) => !publicObjectSet.has(path));
const orphanAvatarObjects = avatarObjects.filter((path) => !referencedAvatarPaths.has(path));
const missingAvatarReferences = [...referencedAvatarPaths].filter((path) => !avatarObjectSet.has(path));

if (findings.length === 0 && orphanObjects.length === 0 && missingReferences.length === 0
  && orphanAvatarObjects.length === 0 && missingAvatarReferences.length === 0
  && invalidAvatarReferences.length === 0) {
  console.log(`PASS: 0 public project-media references, 0 public orphans and 0 missing public objects (${publicObjects.length} legacy object(s) and ${avatarObjects.length} avatar(s) checked).`);
  process.exit(0);
}

console.error(`NO-GO: ${findings.length} public project-media reference(s), ${orphanObjects.length} trip-media orphan(s), ${missingReferences.length} missing trip-media reference(s), ${orphanAvatarObjects.length} avatar orphan(s), ${missingAvatarReferences.length} missing avatar reference(s), ${invalidAvatarReferences.length} invalid avatar path(s).`);
if (findings.length > 0) {
  console.error(`Project media still stored publicly (max ${MAX_EXAMPLES}):`);
  console.table(findings.slice(0, MAX_EXAMPLES));
}
if (orphanObjects.length > 0) {
  console.error(`Unreferenced trip-media objects (max ${MAX_EXAMPLES}):`);
  console.table(orphanObjects.slice(0, MAX_EXAMPLES).map((object_path) => ({ object_path })));
}
if (missingReferences.length > 0) {
  console.error(`Database references without an object (max ${MAX_EXAMPLES}):`);
  console.table(missingReferences.slice(0, MAX_EXAMPLES).map((object_path) => ({ object_path })));
}
if (orphanAvatarObjects.length > 0) {
  console.error(`Unreferenced avatar objects (max ${MAX_EXAMPLES}):`);
  console.table(orphanAvatarObjects.slice(0, MAX_EXAMPLES).map((object_path) => ({ object_path })));
}
if (missingAvatarReferences.length > 0) {
  console.error(`Avatar references without an object (max ${MAX_EXAMPLES}):`);
  console.table(missingAvatarReferences.slice(0, MAX_EXAMPLES).map((object_path) => ({ object_path })));
}
if (invalidAvatarReferences.length > 0) {
  console.error(`Avatar references outside their owner slot (max ${MAX_EXAMPLES}):`);
  console.table(invalidAvatarReferences.slice(0, MAX_EXAMPLES));
}
console.error("Copy every project asset to trip-private before updating its stable path; this is required even for projects that are public today so a later privacy toggle is safe. Review every orphan/missing reference before deleting or repairing anything; this audit never mutates data.");
process.exit(1);
