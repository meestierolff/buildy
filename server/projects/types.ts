import type {
  CreateProjectInput,
  CreateProjectPhaseInput,
  CreateUpdateInput,
  DeleteProjectInput,
  DeleteUpdateInput,
  EditUpdateInput,
  FollowingActivity,
  ProjectCard,
  ProjectOverview,
  ProjectUpdate,
  ProjectDeletionStatus,
  UpdateProjectInput,
} from "../../shared/contracts/projects.js";
import type { DashboardCursor, DiscoveryCursor, TimelineCursor } from "./cursor.js";
import type { ProjectActor } from "./actor.js";

export const STANDARD_PROJECT_PHASES = [
  "Voorbereiding",
  "Sloopwerk",
  "Ruwbouw",
  "Installaties",
  "Afwerking",
  "Oplevering",
] as const;

export type EncryptedProjectPrivateDetails = {
  addressLine1Ciphertext: string | null;
  addressLine2Ciphertext: string | null;
  postalCodeCiphertext: string | null;
  cityCiphertext: string | null;
  countryCode: string | null;
  contractorNotesCiphertext: string | null;
  encryptionKeyVersion: number;
};

export type CreateProjectCommand = {
  projectId: string;
  ownerId: string;
  slug: string;
  input: CreateProjectInput;
  privateDetails: EncryptedProjectPrivateDetails;
  idempotencyKey: string;
  requestHash: string;
};

export type UpdateProjectCommand = {
  projectId: string;
  ownerId: string;
  input: UpdateProjectInput;
  now: Date;
};

export type CreateUpdateCommand = {
  updateId: string;
  projectId: string;
  actorId: string;
  input: CreateUpdateInput;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
};

export type EditUpdateCommand = {
  updateId: string;
  projectId: string;
  actorId: string;
  input: EditUpdateInput;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
};

export type DeleteUpdateCommand = {
  updateId: string;
  projectId: string;
  actorId: string;
  input: DeleteUpdateInput;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
};

export type DeleteProjectCommand = {
  projectId: string;
  actorId: string;
  input: DeleteProjectInput;
  idempotencyKey: string;
  retentionPolicyVersion: string;
};

export type ProjectDeletionMutation = {
  jobId: string;
  projectId: string;
  status: ProjectDeletionStatus;
  activeOrderCount: number;
  replayed: boolean;
};

export type CreateProjectPhaseCommand = {
  phaseId: string;
  projectId: string;
  actorId: string;
  input: CreateProjectPhaseInput;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
};

export type MutationReference = {
  id: string;
  replayed: boolean;
};

export interface ProjectRepository {
  createProject(command: CreateProjectCommand): Promise<MutationReference>;
  updateProject(command: UpdateProjectCommand): Promise<void>;
  listDashboard(actorId: string, cursor: DashboardCursor | undefined, limit: number): Promise<ProjectCard[]>;
  listDiscovery(viewer: ProjectActor, cursor: DiscoveryCursor | undefined, limit: number): Promise<ProjectCard[]>;
  listFollowingProjects(actorId: string, limit: number): Promise<ProjectCard[]>;
  listFollowingActivity(actorId: string, limit: number): Promise<FollowingActivity[]>;
  getOverview(viewer: ProjectActor, projectId: string): Promise<ProjectOverview | null>;
  listTimeline(
    viewer: ProjectActor,
    projectId: string,
    cursor: TimelineCursor | undefined,
    limit: number,
  ): Promise<ProjectUpdate[] | null>;
  getUpdate(viewer: ProjectActor, projectId: string, updateId: string): Promise<ProjectUpdate | null>;
  createUpdate(command: CreateUpdateCommand): Promise<MutationReference>;
  editUpdate(command: EditUpdateCommand): Promise<MutationReference>;
  deleteUpdate(command: DeleteUpdateCommand): Promise<MutationReference>;
  requestProjectDeletion(command: DeleteProjectCommand): Promise<ProjectDeletionMutation>;
  createProjectPhase(command: CreateProjectPhaseCommand): Promise<MutationReference>;
}

export interface ProjectPrivateDetailsProtector {
  readonly currentKeyVersion: number;
  protect(plaintext: string, context: string): string;
}

export type Clock = () => Date;
export type IdFactory = () => string;
