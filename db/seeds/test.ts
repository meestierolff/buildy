import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  appUsers,
  authIdentityMappings,
  authUsers,
  betaInvites,
  photobookDrafts,
  profiles,
  projectPhases,
  projectPrivateDetails,
  projects,
  updates,
} from "../schema/index.js";
import { buildPhotobookDocument } from "../../server/photobooks/document.js";

const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  viewer: "00000000-0000-4000-8000-000000000002",
  ownerProfile: "00000000-0000-4000-8000-000000000011",
  viewerProfile: "00000000-0000-4000-8000-000000000012",
  project: "00000000-0000-4000-8000-000000000021",
  phase: "00000000-0000-4000-8000-000000000031",
  update: "00000000-0000-4000-8000-000000000041",
  draft: "00000000-0000-4000-8000-000000000051",
  invite: "00000000-0000-4000-8000-000000000061",
  ownerMapping: "00000000-0000-4000-8000-000000000071",
  viewerMapping: "00000000-0000-4000-8000-000000000072",
} as const;

const authIds = {
  owner: "test-auth-owner",
  viewer: "test-auth-viewer",
} as const;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function seedTestData(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to load the synthetic test seed.");
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool);
  const photobookDocument = buildPhotobookDocument({
    projectId: ids.project,
    projectRevision: 1,
    projectTitle: "Synthetische renovatie",
    maximumPages: 120,
    updates: [],
    measurer: {
      wrap: ({ text }) => text.trim() ? [text.trim()] : [],
    },
  });

  try {
    await db.transaction(async (tx) => {
  await tx
    .insert(authUsers)
    .values([
      {
        id: authIds.owner,
        name: "Test Eigenaar",
        email: "owner@example.test",
        emailVerified: true,
      },
      {
        id: authIds.viewer,
        name: "Test Bezoeker",
        email: "viewer@example.test",
        emailVerified: true,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(appUsers)
    .values([{ id: ids.owner }, { id: ids.viewer }])
    .onConflictDoNothing();

  await tx
    .insert(authIdentityMappings)
    .values([
      {
        id: ids.ownerMapping,
        appUserId: ids.owner,
        authUserId: authIds.owner,
        legacyProvider: "synthetic-test",
        legacySubjectId: ids.owner,
        migrationStatus: "linked",
        linkedAt: new Date("2026-08-04T10:00:00.000Z"),
      },
      {
        id: ids.viewerMapping,
        appUserId: ids.viewer,
        authUserId: authIds.viewer,
        legacyProvider: "synthetic-test",
        legacySubjectId: ids.viewer,
        migrationStatus: "linked",
        linkedAt: new Date("2026-08-04T10:00:00.000Z"),
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(profiles)
    .values([
      {
        id: ids.ownerProfile,
        userId: ids.owner,
        displayName: "Test Eigenaar",
        slug: "test-eigenaar",
        bio: "Synthetisch profiel voor lokale tests.",
        isPrivate: true,
      },
      {
        id: ids.viewerProfile,
        userId: ids.viewer,
        displayName: "Test Bezoeker",
        slug: "test-bezoeker",
        bio: "Synthetisch profiel voor lokale tests.",
        isPrivate: false,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(projects)
    .values({
      id: ids.project,
      ownerId: ids.owner,
      slug: "synthetische-verbouwing",
      title: "Synthetische verbouwing",
      description: "Alleen bedoeld voor geautomatiseerde tests.",
      projectType: "renovatie",
      startDate: "2026-01-05",
      expectedEndDate: "2026-12-18",
      visibility: "private",
      progressPercentage: 25,
      contentRevision: 1,
    })
    .onConflictDoNothing();

  await tx
    .insert(projectPrivateDetails)
    .values({
      projectId: ids.project,
      ownerId: ids.owner,
      countryCode: "NL",
    })
    .onConflictDoNothing();

  await tx
    .insert(projectPhases)
    .values({
      id: ids.phase,
      projectId: ids.project,
      name: "Sloopwerk",
      sortOrder: 0,
    })
    .onConflictDoNothing();

  await tx
    .insert(updates)
    .values({
      id: ids.update,
      projectId: ids.project,
      projectOwnerId: ids.owner,
      authorId: ids.owner,
      phaseId: ids.phase,
      title: "Eerste synthetische update",
      room: "Woonkamer",
      description: "Testinhoud zonder persoonsgegevens.",
      updateDate: "2026-01-10",
      status: "published",
      publishedAt: new Date("2026-01-10T12:00:00.000Z"),
    })
    .onConflictDoNothing();

  await tx
    .insert(photobookDrafts)
    .values({
      id: ids.draft,
      projectId: ids.project,
      ownerId: ids.owner,
      projectRevision: 1,
      document: photobookDocument,
      documentSha256: photobookDocument.checksumSha256,
      pageCount: photobookDocument.pageCount,
      selectedFormat: photobookDocument.selectedFormat,
    })
    .onConflictDoNothing();

  await tx
    .insert(betaInvites)
    .values({
      id: ids.invite,
      codeHash: sha256("BUILDY-SYNTHETIC-TEST-INVITE"),
      emailHash: sha256("viewer@example.test"),
      expiresAt: new Date("2099-12-31T23:59:59.000Z"),
      maxUses: 10,
      metadata: { fixture: true },
    })
    .onConflictDoNothing();
    });
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  await seedTestData();
}
