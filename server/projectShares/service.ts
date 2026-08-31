import {
  issueProjectShareLinkInputSchema,
  redeemProjectShareLinkInputSchema,
  revokeProjectShareLinkInputSchema,
  rotateProjectShareLinkInputSchema,
  type ProjectShareLink,
  type ProjectShareLinkMutation,
  type ProjectShareLinkRedemption,
  type ProjectShareLinkRevocation,
  type ProjectShareLinkState,
} from "../../shared/contracts/projectShares.js";
import type { ProjectActor } from "../projects/actor.js";
import { HmacProjectShareTokens } from "./crypto.js";
import { ProjectShareError } from "./errors.js";
import type {
  ProjectShareClock,
  ProjectShareIdFactory,
  ProjectShareRepository,
  StoredProjectShareLink,
} from "./types.js";

const MIN_EXPIRY_MS = 5 * 60 * 1_000;
const MAX_EXPIRY_MS = 90 * 24 * 60 * 60 * 1_000;

function publicLink(link: StoredProjectShareLink, now: Date): ProjectShareLink {
  return {
    id: link.id,
    projectId: link.projectId,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
    version: link.version,
    state: new Date(link.expiresAt).getTime() <= now.getTime() ? "expired" : "active",
  };
}

function authenticatedActorId(actor: ProjectActor): string {
  if (actor.kind === "anonymous") throw new ProjectShareError("ACTOR_REQUIRED");
  return actor.appUserId;
}

export class ProjectShareService {
  private readonly appOrigin: string;

  constructor(
    private readonly repository: ProjectShareRepository,
    private readonly tokens: HmacProjectShareTokens,
    appOrigin: string,
    private readonly clock: ProjectShareClock = () => new Date(),
    private readonly createId: ProjectShareIdFactory = () => crypto.randomUUID(),
  ) {
    this.appOrigin = new URL(appOrigin).origin;
  }

  async ownerState(actor: ProjectActor, projectId: string): Promise<ProjectShareLinkState> {
    const link = await this.repository.getOwnerLink(authenticatedActorId(actor), projectId);
    return { projectId, link: link ? publicLink(link, this.clock()) : null };
  }

  async create(
    actor: ProjectActor,
    projectId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<ProjectShareLinkMutation> {
    const input = issueProjectShareLinkInputSchema.parse(rawInput);
    return this.issue(actor, projectId, "create", input, null, requestId);
  }

  async rotate(
    actor: ProjectActor,
    projectId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<ProjectShareLinkMutation> {
    const input = rotateProjectShareLinkInputSchema.parse(rawInput);
    return this.issue(actor, projectId, "rotate", input, input.expectedVersion, requestId);
  }

  private async issue(
    actor: ProjectActor,
    projectId: string,
    operation: "create" | "rotate",
    input: { expiresAt: string; idempotencyKey: string },
    expectedVersion: number | null,
    requestId: string,
  ): Promise<ProjectShareLinkMutation> {
    const actorId = authenticatedActorId(actor);
    const now = this.clock();
    const expiresAt = new Date(input.expiresAt);
    const lifetime = expiresAt.getTime() - now.getTime();
    if (!Number.isFinite(lifetime) || lifetime < MIN_EXPIRY_MS || lifetime > MAX_EXPIRY_MS) {
      throw new ProjectShareError("EXPIRY_INVALID");
    }

    const token = this.tokens.issueToken({ actorId, projectId, operation, idempotencyKey: input.idempotencyKey });
    const result = await this.repository.issue({
      actorId,
      projectId,
      linkId: this.createId(),
      operation,
      expiresAt,
      expectedVersion,
      tokenHash: this.tokens.tokenHash(token),
      idempotencyHash: this.tokens.mutationHash({ actorId, projectId, operation, idempotencyKey: input.idempotencyKey }),
      requestHash: this.tokens.requestHash([
        operation,
        actorId,
        projectId,
        expiresAt.toISOString(),
        expectedVersion === null ? "" : String(expectedVersion),
        input.idempotencyKey,
      ]),
      requestId,
    });
    if (result.link.revokedAt) throw new ProjectShareError("VERSION_CONFLICT");

    const shareUrl = new URL("/delen", this.appOrigin);
    shareUrl.hash = `toegang=${token}`;
    return {
      link: publicLink(result.link, now),
      shareUrl: shareUrl.toString(),
      replayed: result.replayed,
    };
  }

  async revoke(
    actor: ProjectActor,
    projectId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<ProjectShareLinkRevocation> {
    const actorId = authenticatedActorId(actor);
    const input = revokeProjectShareLinkInputSchema.parse(rawInput);
    const result = await this.repository.revoke({
      actorId,
      projectId,
      expectedVersion: input.expectedVersion,
      idempotencyHash: this.tokens.mutationHash({
        actorId,
        projectId,
        operation: "revoke",
        idempotencyKey: input.idempotencyKey,
      }),
      requestHash: this.tokens.requestHash([
        "revoke",
        actorId,
        projectId,
        String(input.expectedVersion),
        input.idempotencyKey,
      ]),
      requestId,
    });
    return { ...result, revoked: true };
  }

  async redeem(actor: ProjectActor, rawInput: unknown): Promise<ProjectShareLinkRedemption & { linkId: string }> {
    const input = redeemProjectShareLinkInputSchema.parse(rawInput);
    const result = await this.repository.redeem(actor, this.tokens.tokenHash(input.token));
    if (result.status === "expired") throw new ProjectShareError("LINK_EXPIRED");
    if (result.status !== "active" || !result.linkId || !result.projectId || !result.expiresAt) {
      throw new ProjectShareError("LINK_UNAVAILABLE");
    }
    return {
      projectId: result.projectId,
      cleanPath: `/project/${result.projectId}`,
      expiresAt: result.expiresAt,
      linkId: result.linkId,
    };
  }
}
