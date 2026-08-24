import type { ProjectShareContextResolver } from "../projects/actor.js";
import type { HmacProjectShareTokens } from "./crypto.js";

export const PROJECT_SHARE_COOKIE = "buildy_project_share";

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16_384) return null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 1 || segment.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function parseProjectShareCookie(
  request: Request,
  tokens: HmacProjectShareTokens,
  now = new Date(),
): { linkId: string; expiresAt: Date } | null {
  const value = cookieValue(request, PROJECT_SHARE_COOKIE);
  const match = value && /^v1\.([0-9a-f-]{36})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/i.exec(value);
  if (!match) return null;
  const linkId = match[1].toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(linkId)) {
    return null;
  }
  const epochSeconds = Number(match[2]);
  if (!Number.isSafeInteger(epochSeconds) || epochSeconds * 1_000 <= now.getTime()) return null;
  if (!tokens.grantMatches(linkId, epochSeconds, match[3])) return null;
  return { linkId, expiresAt: new Date(epochSeconds * 1_000) };
}

export class ProjectShareCookieContext implements ProjectShareContextResolver {
  constructor(private readonly tokens: HmacProjectShareTokens) {}

  resolveShareLinkId(request: Request): string | null {
    return parseProjectShareCookie(request, this.tokens)?.linkId ?? null;
  }
}

export function projectShareCookie(
  linkId: string,
  expiresAt: Date,
  secure: boolean,
  tokens: HmacProjectShareTokens,
  now = new Date(),
): string {
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000));
  const expiresAtEpochSeconds = Math.floor(expiresAt.getTime() / 1_000);
  const signature = tokens.grantSignature(linkId, expiresAtEpochSeconds);
  return [
    `${PROJECT_SHARE_COOKIE}=v1.${linkId}.${expiresAtEpochSeconds}.${signature}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function clearProjectShareCookie(secure: boolean): string {
  return [
    `${PROJECT_SHARE_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function withProjectShareCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
