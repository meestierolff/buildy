import type { ProjectShareLink } from "../../shared/contracts/projectShares.js";
import type { ProjectActor } from "../projects/actor.js";

export type StoredProjectShareLink = Omit<ProjectShareLink, "state"> & {
  revokedAt: string | null;
};

export type IssueShareLinkCommand = {
  actorId: string;
  projectId: string;
  linkId: string;
  operation: "create" | "rotate";
  expiresAt: Date;
  expectedVersion: number | null;
  tokenHash: string;
  idempotencyHash: string;
  requestHash: string;
  requestId: string;
};

export type RevokeShareLinkCommand = {
  actorId: string;
  projectId: string;
  expectedVersion: number;
  idempotencyHash: string;
  requestHash: string;
  requestId: string;
};

export type ProjectShareRepository = {
  getOwnerLink(actorId: string, projectId: string): Promise<StoredProjectShareLink | null>;
  issue(command: IssueShareLinkCommand): Promise<{ link: StoredProjectShareLink; replayed: boolean }>;
  revoke(command: RevokeShareLinkCommand): Promise<{
    projectId: string;
    linkId: string;
    version: number;
    replayed: boolean;
  }>;
  redeem(viewer: ProjectActor, tokenHash: string): Promise<{
    status: "active" | "expired" | "unavailable";
    linkId: string | null;
    projectId: string | null;
    expiresAt: string | null;
  }>;
};

export type ProjectShareClock = () => Date;
export type ProjectShareIdFactory = () => string;
