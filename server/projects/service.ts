import {
  createProjectInputSchema,
  createProjectPhaseInputSchema,
  createUpdateInputSchema,
  deleteProjectInputSchema,
  deleteUpdateInputSchema,
  editUpdateInputSchema,
  followingFeedQuerySchema,
  projectPageQuerySchema,
  updateProjectInputSchema,
  type CreateProjectInput,
  type CreateProjectPhaseInput,
  type CreateUpdateInput,
  type DeleteProjectInput,
  type DeleteUpdateInput,
  type EditUpdateInput,
  type FollowingFeed,
  type ProjectOverview,
  type ProjectPage,
  type ProjectPageQuery,
  type ProjectPhase,
  type ProjectUpdate,
  type TimelinePage,
  type UpdateProjectInput,
} from "../../shared/contracts/projects.js";
import { ProjectError } from "./errors.js";
import type { ProjectActor } from "./actor.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";
import { decodeProjectCursor, encodeProjectCursor } from "./cursor.js";
import { projectRequestHash, scopedProjectIdempotencyKey } from "./idempotency.js";
import type {
  Clock,
  CreateProjectCommand,
  EncryptedProjectPrivateDetails,
  IdFactory,
  ProjectPrivateDetailsProtector,
  ProjectDeletionMutation,
  ProjectRepository,
} from "./types.js";

const PROJECT_RETENTION_POLICY_VERSION = "project-erasure-v1";

function projectSlug(title: string, projectId: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "") || "project";
  return `${base}-${projectId.replaceAll("-", "").slice(0, 10)}`;
}

function withoutIdempotencyKey<T extends { idempotencyKey: string }>(input: T): Omit<T, "idempotencyKey"> {
  const { idempotencyKey: _idempotencyKey, ...payload } = input;
  return payload;
}

function encryptPrivateDetails(
  projectId: string,
  input: CreateProjectInput["privateDetails"],
  protector: ProjectPrivateDetailsProtector,
): EncryptedProjectPrivateDetails {
  const protect = (field: string, value: string | undefined): string | null =>
    value ? protector.protect(value, `project:${projectId}:private:${field}`) : null;

  return {
    addressLine1Ciphertext: protect("address_line_1", input?.addressLine1),
    addressLine2Ciphertext: protect("address_line_2", input?.addressLine2),
    postalCodeCiphertext: protect("postal_code", input?.postalCode),
    cityCiphertext: protect("city", input?.city),
    countryCode: input?.countryCode ?? null,
    contractorNotesCiphertext: protect("contractor_notes", input?.contractorNotes),
    encryptionKeyVersion: protector.currentKeyVersion,
  };
}

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly protector: ProjectPrivateDetailsProtector,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly clock: Clock = () => new Date(),
    private readonly createId: IdFactory = () => crypto.randomUUID(),
  ) {}

  async createProject(actorId: string, rawInput: unknown): Promise<{
    project: ProjectOverview;
    replayed: boolean;
  }> {
    const input = createProjectInputSchema.parse(rawInput);
    const projectId = this.createId();
    const operation = "project.create";
    const command: CreateProjectCommand = {
      projectId,
      ownerId: actorId,
      slug: projectSlug(input.title, projectId),
      input,
      privateDetails: encryptPrivateDetails(projectId, input.privateDetails, this.protector),
      idempotencyKey: scopedProjectIdempotencyKey(
        operation,
        actorId,
        undefined,
        input.idempotencyKey,
      ),
      requestHash: projectRequestHash(operation, withoutIdempotencyKey(input), this.blindIndex),
    };
    const result = await this.repository.createProject(command);
    const project = await this.repository.getOverview(
      { kind: "authenticated", appUserId: actorId },
      result.id,
    );
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND");
    return { project, replayed: result.replayed };
  }

  async updateProject(
    actorId: string,
    projectId: string,
    rawInput: unknown,
  ): Promise<{ project: ProjectOverview; replayed: false }> {
    const input: UpdateProjectInput = updateProjectInputSchema.parse(rawInput);
    await this.repository.updateProject({ projectId, ownerId: actorId, input, now: this.clock() });
    const project = await this.repository.getOverview(
      { kind: "authenticated", appUserId: actorId },
      projectId,
    );
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND");
    return { project, replayed: false };
  }

  async requestProjectDeletion(
    actorId: string,
    projectId: string,
    rawInput: unknown,
  ): Promise<ProjectDeletionMutation> {
    const input: DeleteProjectInput = deleteProjectInputSchema.parse(rawInput);
    const mutation = await this.repository.requestProjectDeletion({
      projectId,
      actorId,
      input,
      idempotencyKey: scopedProjectIdempotencyKey(
        "project.delete",
        actorId,
        projectId,
        input.idempotencyKey,
      ),
      retentionPolicyVersion: PROJECT_RETENTION_POLICY_VERSION,
    });
    if (mutation.status === "blocked_active_order") throw new ProjectError("ACTIVE_ORDER");
    return mutation;
  }

  async dashboard(actorId: string, rawQuery: unknown): Promise<ProjectPage> {
    const query: ProjectPageQuery = projectPageQuerySchema.parse(rawQuery);
    const cursor = decodeProjectCursor(query.cursor, "dashboard");
    const rows = await this.repository.listDashboard(actorId, cursor, query.limit + 1);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > query.limit && last
        ? encodeProjectCursor({
            version: 1,
            kind: "dashboard",
            timestamp: last.updatedAt,
            id: last.id,
          })
        : null,
    };
  }

  async discovery(viewer: ProjectActor, rawQuery: unknown): Promise<ProjectPage> {
    const query: ProjectPageQuery = projectPageQuerySchema.parse(rawQuery);
    const cursor = decodeProjectCursor(query.cursor, "discovery");
    const rows = await this.repository.listDiscovery(viewer, cursor, query.limit + 1);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    if (rows.length > query.limit && last && !last.publishedAt) {
      throw new ProjectError("PROJECT_NOT_FOUND");
    }
    return {
      items,
      nextCursor: rows.length > query.limit && last?.publishedAt
        ? encodeProjectCursor({
            version: 1,
            kind: "discovery",
            timestamp: last.publishedAt,
            id: last.id,
          })
        : null,
    };
  }

  async following(actorId: string, rawQuery: unknown): Promise<FollowingFeed> {
    const actor = actorId.toLowerCase();
    const query = followingFeedQuerySchema.parse(rawQuery);
    const [projects, activity] = await Promise.all([
      this.repository.listFollowingProjects(actor, query.projectLimit),
      this.repository.listFollowingActivity(actor, query.activityLimit),
    ]);
    return { projects, activity };
  }

  async overview(viewer: ProjectActor, projectId: string): Promise<ProjectOverview> {
    const project = await this.repository.getOverview(viewer, projectId);
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND");
    return project;
  }

  async timeline(
    viewer: ProjectActor,
    projectId: string,
    rawQuery: unknown,
  ): Promise<TimelinePage> {
    const query = projectPageQuerySchema.parse(rawQuery);
    const cursor = decodeProjectCursor(query.cursor, "timeline");
    const rows = await this.repository.listTimeline(viewer, projectId, cursor, query.limit + 1);
    if (!rows) throw new ProjectError("PROJECT_NOT_FOUND");
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      projectId,
      items,
      nextCursor: rows.length > query.limit && last
        ? encodeProjectCursor({
            version: 1,
            kind: "timeline",
            updateDate: last.updateDate,
            sortOrder: last.sortOrder,
            id: last.id,
          })
        : null,
    };
  }

  async createUpdate(actorId: string, projectId: string, rawInput: unknown): Promise<{
    update: ProjectUpdate;
    replayed: boolean;
  }> {
    const input: CreateUpdateInput = createUpdateInputSchema.parse(rawInput);
    const operation = "update.create";
    const result = await this.repository.createUpdate({
      updateId: this.createId(),
      projectId,
      actorId,
      input,
      idempotencyKey: scopedProjectIdempotencyKey(
        operation,
        actorId,
        projectId,
        input.idempotencyKey,
      ),
      requestHash: projectRequestHash(operation, withoutIdempotencyKey(input), this.blindIndex),
      now: this.clock(),
    });
    const update = await this.repository.getUpdate(
      { kind: "authenticated", appUserId: actorId },
      projectId,
      result.id,
    );
    if (!update) throw new ProjectError("UPDATE_NOT_FOUND");
    return { update, replayed: result.replayed };
  }

  async editUpdate(
    actorId: string,
    projectId: string,
    updateId: string,
    rawInput: unknown,
  ): Promise<{ update: ProjectUpdate; replayed: boolean }> {
    const input: EditUpdateInput = editUpdateInputSchema.parse(rawInput);
    const operation = input.publish ? "update.publish" : "update.edit";
    const result = await this.repository.editUpdate({
      updateId,
      projectId,
      actorId,
      input,
      idempotencyKey: scopedProjectIdempotencyKey(
        operation,
        actorId,
        updateId,
        input.idempotencyKey,
      ),
      requestHash: projectRequestHash(operation, withoutIdempotencyKey(input), this.blindIndex),
      now: this.clock(),
    });
    const update = await this.repository.getUpdate(
      { kind: "authenticated", appUserId: actorId },
      projectId,
      result.id,
    );
    if (!update) throw new ProjectError("UPDATE_NOT_FOUND");
    return { update, replayed: result.replayed };
  }

  async deleteUpdate(
    actorId: string,
    projectId: string,
    updateId: string,
    rawInput: unknown,
  ): Promise<{
    project: ProjectOverview;
    updateId: string;
    deleted: true;
    replayed: boolean;
  }> {
    const input: DeleteUpdateInput = deleteUpdateInputSchema.parse(rawInput);
    const operation = "update.delete";
    const result = await this.repository.deleteUpdate({
      updateId,
      projectId,
      actorId,
      input,
      idempotencyKey: scopedProjectIdempotencyKey(
        operation,
        actorId,
        updateId,
        input.idempotencyKey,
      ),
      requestHash: projectRequestHash(operation, withoutIdempotencyKey(input), this.blindIndex),
      now: this.clock(),
    });
    const project = await this.repository.getOverview(
      { kind: "authenticated", appUserId: actorId },
      projectId,
    );
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND");
    return { project, updateId: result.id, deleted: true, replayed: result.replayed };
  }

  async createProjectPhase(
    actorId: string,
    projectId: string,
    rawInput: unknown,
  ): Promise<{ project: ProjectOverview; phase: ProjectPhase; replayed: boolean }> {
    const input: CreateProjectPhaseInput = createProjectPhaseInputSchema.parse(rawInput);
    const operation = "project.phase.create";
    const result = await this.repository.createProjectPhase({
      phaseId: this.createId(),
      projectId,
      actorId,
      input,
      idempotencyKey: scopedProjectIdempotencyKey(
        operation,
        actorId,
        projectId,
        input.idempotencyKey,
      ),
      requestHash: projectRequestHash(operation, withoutIdempotencyKey(input), this.blindIndex),
      now: this.clock(),
    });
    const project = await this.repository.getOverview(
      { kind: "authenticated", appUserId: actorId },
      projectId,
    );
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND");
    const phase = project.phases.find((candidate) => candidate.id === result.id);
    if (!phase) throw new ProjectError("INVALID_PHASE");
    return { project, phase, replayed: result.replayed };
  }
}
