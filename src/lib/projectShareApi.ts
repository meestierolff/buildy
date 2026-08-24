import { z } from "zod";

import {
  issueProjectShareLinkInputSchema,
  projectShareLinkMutationResponseSchema,
  projectShareLinkRedeemResponseSchema,
  projectShareLinkRevokeResponseSchema,
  projectShareLinkStateResponseSchema,
  redeemProjectShareLinkInputSchema,
  revokeProjectShareLinkInputSchema,
  rotateProjectShareLinkInputSchema,
  type IssueProjectShareLinkInput,
  type ProjectShareLinkMutation,
  type ProjectShareLinkRedemption,
  type ProjectShareLinkRevocation,
  type ProjectShareLinkState,
  type RevokeProjectShareLinkInput,
  type RotateProjectShareLinkInput,
} from "../../shared/contracts/projectShares";
import { apiRequest } from "./apiClient";

const uuidSchema = z.string().uuid();

function ownerPath(projectId: string): `/api/projects/${string}/share-link` {
  return `/api/projects/${encodeURIComponent(uuidSchema.parse(projectId))}/share-link`;
}

export async function getProjectShareLink(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectShareLinkState> {
  return (await apiRequest(ownerPath(projectId), projectShareLinkStateResponseSchema, { signal })).data;
}

export async function createProjectShareLink(
  projectId: string,
  input: IssueProjectShareLinkInput,
): Promise<ProjectShareLinkMutation> {
  const body = issueProjectShareLinkInputSchema.parse(input);
  return (await apiRequest(ownerPath(projectId), projectShareLinkMutationResponseSchema, {
    method: "POST",
    body,
  })).data;
}

export async function rotateProjectShareLink(
  projectId: string,
  input: RotateProjectShareLinkInput,
): Promise<ProjectShareLinkMutation> {
  const body = rotateProjectShareLinkInputSchema.parse(input);
  return (await apiRequest(`${ownerPath(projectId)}/rotate`, projectShareLinkMutationResponseSchema, {
    method: "POST",
    body,
  })).data;
}

export async function revokeProjectShareLink(
  projectId: string,
  input: RevokeProjectShareLinkInput,
): Promise<ProjectShareLinkRevocation> {
  const body = revokeProjectShareLinkInputSchema.parse(input);
  return (await apiRequest(ownerPath(projectId), projectShareLinkRevokeResponseSchema, {
    method: "DELETE",
    body,
  })).data;
}

export async function redeemProjectShareLink(token: string): Promise<ProjectShareLinkRedemption> {
  const body = redeemProjectShareLinkInputSchema.parse({ token });
  return (await apiRequest(
    "/api/project-share-links/redeem",
    projectShareLinkRedeemResponseSchema,
    { method: "POST", body },
  )).data;
}
