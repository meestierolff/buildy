import {
  createProjectInputSchema,
  createUpdateInputSchema,
  deleteUpdateInputSchema,
  editUpdateInputSchema,
  type CreateProjectInput,
  type CreateUpdateInput,
  type DeleteUpdateInput,
  type EditUpdateInput,
  type ProjectOverview,
  type UpdateMediaInput,
} from "../../shared/contracts/projects";

export type NewProjectDraft = {
  title: string;
  description: string;
  projectType: string;
  address: string;
  startDate: string;
  expectedEndDate: string;
  visibility: "private" | "public";
};

export type CreateProjectFlowCommand = {
  input: CreateProjectInput;
  visibility: "private" | "public";
};

function nonEmpty(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

export function buildCreateProjectCommand(
  draft: NewProjectDraft,
  idempotencyKey: string,
): CreateProjectFlowCommand {
  const addressLine1 = nonEmpty(draft.address);
  return {
    input: createProjectInputSchema.parse({
      idempotencyKey,
      title: draft.title.trim(),
      description: nonEmpty(draft.description),
      projectType: nonEmpty(draft.projectType),
      startDate: draft.startDate || undefined,
      expectedEndDate: draft.expectedEndDate || undefined,
      privateDetails: addressLine1 ? { addressLine1 } : undefined,
    }),
    visibility: draft.visibility,
  };
}

export type UpdateComposerMedia = {
  assetId: string;
  compareRole: "before" | "after" | null;
};

export type UpdateComposerDraft = {
  title: string;
  description: string;
  updateDate: string;
  phaseId: string;
  isMilestone: boolean;
  media: readonly UpdateComposerMedia[];
};

export function buildCreateUpdateCommand(
  draft: UpdateComposerDraft,
  project: Pick<ProjectOverview, "version">,
  idempotencyKey: string,
): CreateUpdateInput {
  const media: UpdateMediaInput[] = draft.media.map((item, sortOrder) => ({
    assetId: item.assetId,
    role: item.compareRole ?? "gallery",
    sortOrder,
  }));

  return createUpdateInputSchema.parse({
    idempotencyKey,
    expectedProjectVersion: project.version,
    updateDate: draft.updateDate,
    title: draft.title.trim(),
    description: nonEmpty(draft.description),
    phaseId: draft.phaseId || undefined,
    isMilestone: draft.isMilestone,
    media,
    publish: true,
  });
}

export type EditUpdateDraft = {
  title: string;
  room: string;
  description: string;
  updateDate: string;
  phaseId: string;
  isMilestone: boolean;
  media: ReadonlyArray<UpdateComposerMedia & { caption?: string | null }>;
};

export function buildEditUpdateCommand(
  draft: EditUpdateDraft,
  expectedVersion: number,
  idempotencyKey: string,
): EditUpdateInput {
  return editUpdateInputSchema.parse({
    idempotencyKey,
    expectedVersion,
    updateDate: draft.updateDate,
    title: nonEmpty(draft.title) ?? null,
    room: nonEmpty(draft.room) ?? null,
    description: nonEmpty(draft.description) ?? null,
    phaseId: draft.phaseId || null,
    isMilestone: draft.isMilestone,
    media: draft.media.map((item, sortOrder) => {
      const caption = item.caption?.trim();
      return {
        assetId: item.assetId,
        role: item.compareRole ?? "gallery",
        sortOrder,
        ...(caption ? { caption } : {}),
      };
    }),
  });
}

export function buildDeleteUpdateCommand(
  expectedVersion: number,
  idempotencyKey: string,
): DeleteUpdateInput {
  return deleteUpdateInputSchema.parse({
    idempotencyKey,
    expectedVersion,
    confirmation: "delete-update",
  });
}
