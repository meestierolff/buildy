import { z } from "zod";
import {
  dashboardResponseSchema,
  deleteProjectMutationResponseSchema,
  deleteUpdateMutationResponseSchema,
  discoveryResponseSchema,
  followingFeedQuerySchema,
  followingFeedResponseSchema,
  projectMutationResponseSchema,
  projectOverviewResponseSchema,
  projectPageQuerySchema,
  projectPhaseMutationResponseSchema,
  timelineResponseSchema,
  updateMutationResponseSchema,
  type CreateProjectInput,
  type CreateProjectPhaseInput,
  type CreateUpdateInput,
  type DeleteProjectInput,
  type DeleteUpdateInput,
  type EditUpdateInput,
  type FollowingFeed,
  type ProjectOverview,
  type ProjectDeletionStatus,
  type ProjectPage,
  type ProjectPageQuery,
  type ProjectPhase,
  type ProjectUpdate,
  type ProjectVisibility,
  type TimelinePage,
  type UpdateProjectInput,
} from "../../shared/contracts/projects";
import { apiRequest } from "./apiClient";

const uuidSchema = z.string().uuid();

function projectPath(projectId: string): `/api/projects/${string}` {
  return `/api/projects/${encodeURIComponent(uuidSchema.parse(projectId))}`;
}

function updatesPath(projectId: string): `/api/projects/${string}/updates` {
  return `${projectPath(projectId)}/updates`;
}

function updatePath(projectId: string, updateId: string): `/api/projects/${string}/updates/${string}` {
  return `${updatesPath(projectId)}/${encodeURIComponent(uuidSchema.parse(updateId))}`;
}

function phasesPath(projectId: string): `/api/projects/${string}/phases` {
  return `${projectPath(projectId)}/phases`;
}

export type ProjectMutationResult = {
  project: ProjectOverview;
  replayed: boolean;
};

export type ProjectUpdateMutationResult = {
  update: ProjectUpdate;
  replayed: boolean;
};

export type DeleteProjectUpdateMutationResult = {
  project: ProjectOverview;
  updateId: string;
  deleted: true;
  replayed: boolean;
};

export type DeleteProjectMutationResult = {
  deletion: {
    id: string;
    projectId: string;
    status: ProjectDeletionStatus;
    activeOrderCount: number;
  };
  replayed: boolean;
};

export type ProjectPhaseMutationResult = {
  project: ProjectOverview;
  phase: ProjectPhase;
  replayed: boolean;
};

async function getProjectPage(
  path: "/api/projects" | "/api/discovery",
  input: Partial<ProjectPageQuery>,
  signal?: AbortSignal,
): Promise<ProjectPage> {
  const parsed = projectPageQuerySchema.parse(input);
  const query = new URLSearchParams({ limit: String(parsed.limit) });
  if (parsed.cursor) query.set("cursor", parsed.cursor);
  const schema = path === "/api/projects" ? dashboardResponseSchema : discoveryResponseSchema;
  return (await apiRequest(`${path}?${query.toString()}`, schema, { signal })).data as ProjectPage;
}

export function getProjectDashboard(
  input: Partial<ProjectPageQuery> = {},
  signal?: AbortSignal,
): Promise<ProjectPage> {
  return getProjectPage("/api/projects", input, signal);
}

export function getProjectDiscovery(
  input: Partial<ProjectPageQuery> = {},
  signal?: AbortSignal,
): Promise<ProjectPage> {
  return getProjectPage("/api/discovery", input, signal);
}

export async function getFollowingFeed(
  input: { projectLimit?: number; activityLimit?: number } = {},
  signal?: AbortSignal,
): Promise<FollowingFeed> {
  const parsed = followingFeedQuerySchema.parse(input);
  const query = new URLSearchParams({
    projectLimit: String(parsed.projectLimit),
    activityLimit: String(parsed.activityLimit),
  });
  return (await apiRequest(
    `/api/following?${query.toString()}`,
    followingFeedResponseSchema,
    { signal },
  )).data as FollowingFeed;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectMutationResult> {
  const response = await apiRequest(
    "/api/projects",
    projectMutationResponseSchema,
    { method: "POST", body: input },
  );
  // Runtime validation above guarantees these required response members. The
  // app's legacy non-strict TS config otherwise widens Zod object outputs.
  return response.data as ProjectMutationResult;
}

export async function getProjectOverview(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectOverview> {
  return (await apiRequest(
    projectPath(projectId),
    projectOverviewResponseSchema,
    { signal },
  )).data;
}

export async function getProjectTimeline(
  projectId: string,
  input: Partial<ProjectPageQuery> = {},
  signal?: AbortSignal,
): Promise<TimelinePage> {
  const parsed = projectPageQuerySchema.parse(input);
  const query = new URLSearchParams({ limit: String(parsed.limit) });
  if (parsed.cursor) query.set("cursor", parsed.cursor);
  return (await apiRequest(
    `${updatesPath(projectId)}?${query.toString()}`,
    timelineResponseSchema,
    { signal },
  )).data as TimelinePage;
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectMutationResult> {
  const response = await apiRequest(
    projectPath(projectId),
    projectMutationResponseSchema,
    { method: "PATCH", body: input },
  );
  return response.data as ProjectMutationResult;
}

export async function deleteProject(
  projectId: string,
  input: DeleteProjectInput,
): Promise<DeleteProjectMutationResult> {
  const response = await apiRequest(
    projectPath(projectId),
    deleteProjectMutationResponseSchema,
    { method: "DELETE", body: input },
  );
  return response.data as DeleteProjectMutationResult;
}

export async function createProjectUpdate(
  projectId: string,
  input: CreateUpdateInput,
): Promise<ProjectUpdateMutationResult> {
  const response = await apiRequest(
    updatesPath(projectId),
    updateMutationResponseSchema,
    { method: "POST", body: input },
  );
  return response.data as ProjectUpdateMutationResult;
}

export async function editProjectUpdate(
  projectId: string,
  updateId: string,
  input: EditUpdateInput,
): Promise<ProjectUpdateMutationResult> {
  const response = await apiRequest(
    updatePath(projectId, updateId),
    updateMutationResponseSchema,
    { method: "PATCH", body: input },
  );
  return response.data as ProjectUpdateMutationResult;
}

export async function deleteProjectUpdate(
  projectId: string,
  updateId: string,
  input: DeleteUpdateInput,
): Promise<DeleteProjectUpdateMutationResult> {
  const response = await apiRequest(
    updatePath(projectId, updateId),
    deleteUpdateMutationResponseSchema,
    { method: "DELETE", body: input },
  );
  return response.data as DeleteProjectUpdateMutationResult;
}

export async function createProjectPhase(
  projectId: string,
  input: CreateProjectPhaseInput,
): Promise<ProjectPhaseMutationResult> {
  const response = await apiRequest(
    phasesPath(projectId),
    projectPhaseMutationResponseSchema,
    { method: "POST", body: input },
  );
  return response.data as ProjectPhaseMutationResult;
}

export class ProjectVisibilityContinuationError extends Error {
  constructor(
    public readonly projectId: string,
    options?: ErrorOptions,
  ) {
    super("De verbouwing is aangemaakt, maar de gekozen zichtbaarheid kon nog niet veilig worden bevestigd.", options);
    this.name = "ProjectVisibilityContinuationError";
  }
}

/**
 * Project creation is private by default. A shared visibility is a second,
 * optimistic write. Retrying the same create command first replays the project
 * and therefore safely resumes or reconciles an uncertain visibility write.
 */
export async function createProjectWithVisibility(input: {
  input: CreateProjectInput;
  visibility: ProjectVisibility;
}): Promise<ProjectMutationResult> {
  const created = await createProject(input.input);
  if (input.visibility === "private" || created.project.visibility === input.visibility) return created;

  try {
    const visible = await updateProject(created.project.id, {
      expectedVersion: created.project.version,
      visibility: input.visibility,
    });
    return { ...visible, replayed: created.replayed };
  } catch (cause) {
    try {
      const current = await getProjectOverview(created.project.id);
      if (current.visibility === input.visibility) {
        return { project: current, replayed: created.replayed };
      }
    } catch {
      // A retry with the same create idempotency key performs reconciliation again.
    }
    throw new ProjectVisibilityContinuationError(created.project.id, { cause });
  }
}
