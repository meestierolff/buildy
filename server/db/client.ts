import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../db/schema/index.js";
import { logEvent, safeErrorFields } from "../observability/logger.js";

export type BuildyDatabase = NodePgDatabase<typeof schema>;

interface DatabaseResources {
  database: BuildyDatabase;
  databaseUrl: string;
  pool: Pool;
}

let cachedResources: DatabaseResources | undefined;
type WorkerKind = "account" | "email" | "fulfilment" | "media" | "payment" | "photobook";

const cachedWorkerResources = new Map<WorkerKind, DatabaseResources>();

export function createBuildyDatabase(
  databaseUrl: string,
  options: { applicationName?: string; maxConnections?: number } = {},
): DatabaseResources {
  const pool = new Pool({
    allowExitOnIdle: true,
    application_name: options.applicationName ?? "buildy-web-api",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max: options.maxConnections ?? 5,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });

  pool.on("error", (error) => {
    logEvent("error", "database.idle_connection_error", safeErrorFields(error));
  });

  return {
    database: drizzle(pool, { schema }),
    databaseUrl,
    pool,
  };
}

export function getBuildyDatabase(databaseUrl: string): BuildyDatabase {
  cachedResources ??= createBuildyDatabase(databaseUrl);
  if (cachedResources.databaseUrl !== databaseUrl) {
    throw new Error("De database-runtime is al met een andere verbinding geïnitialiseerd.");
  }
  return cachedResources.database;
}

export function getBuildyWorkerDatabase(
  databaseUrl: string,
  worker: WorkerKind,
): BuildyDatabase {
  const cached = cachedWorkerResources.get(worker);
  if (!cached) {
    cachedWorkerResources.set(worker, createBuildyDatabase(databaseUrl, {
      applicationName: `buildy-${worker}-worker`,
      maxConnections: 2,
    }));
  }
  const resources = cachedWorkerResources.get(worker)!;
  if (resources.databaseUrl !== databaseUrl) {
    throw new Error(`De ${worker}-worker is al met een andere verbinding geïnitialiseerd.`);
  }
  return resources.database;
}

export async function closeBuildyDatabaseForTests(): Promise<void> {
  const resources = cachedResources;
  const workerResources = [...cachedWorkerResources.values()];
  cachedResources = undefined;
  cachedWorkerResources.clear();
  await Promise.all([resources?.pool.end(), ...workerResources.map((worker) => worker.pool.end())]);
}
