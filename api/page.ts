import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getRuntimeConfig } from "../server/config/runtime.js";
import { getBuildyDatabase } from "../server/db/client.js";
import { ANONYMOUS_PROJECT_ACTOR } from "../server/projects/actor.js";
import { PostgresProjectRepository } from "../server/projects/repository.js";
import {
  createProjectPageHandler,
  type PublicProjectPageData,
} from "../server/pages/projectPage.js";

let cachedShell: string | undefined;

async function loadSpaShell(): Promise<string> {
  cachedShell ??= await readFile(resolve(process.cwd(), "dist/index.html"), "utf8");
  return cachedShell;
}

function validatedAppOrigin(): string {
  const config = getRuntimeConfig();
  const origin = new URL(config.APP_ORIGIN);
  if (config.APP_ENV === "production") {
    if (!config.PRIMARY_DOMAIN) throw new Error("PRIMARY_DOMAIN ontbreekt voor projectmetadata.");
    const primary = new URL(config.PRIMARY_DOMAIN);
    if (primary.origin !== origin.origin || origin.protocol !== "https:") {
      throw new Error("APP_ORIGIN en PRIMARY_DOMAIN komen niet veilig overeen.");
    }
  }
  return origin.origin;
}

async function readAnonymousPublicProject(projectId: string): Promise<PublicProjectPageData | null> {
  const config = getRuntimeConfig();
  if (!config.DATABASE_URL) return null;
  const project = await new PostgresProjectRepository(getBuildyDatabase(config.DATABASE_URL))
    .getOverview(ANONYMOUS_PROJECT_ACTOR, projectId);
  if (!project || project.visibility !== "public" || project.viewerAccess !== "public") return null;
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    ownerDisplayName: project.owner.displayName,
    coverAssetId: project.cover?.id ?? null,
  };
}

export default {
  fetch(request: Request): Promise<Response> {
    let appOrigin: string;
    let publicReader = readAnonymousPublicProject;
    try {
      appOrigin = validatedAppOrigin();
    } catch {
      appOrigin = "https://buildy.invalid";
      publicReader = async () => null;
    }

    return createProjectPageHandler({
      appOrigin,
      loadSpaShell,
      readAnonymousPublicProject: publicReader,
    })(request);
  },
};
