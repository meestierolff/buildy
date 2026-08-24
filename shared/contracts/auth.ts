import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

const BLOCKED_NEXT_PATHS = [
  "/api",
  "/auth",
  "/wachtwoord-vergeten",
  "/wachtwoord-resetten",
] as const;
const NEXT_URL_BASE = "https://navigation.buildy.invalid";

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function decodedPathIsSafe(value: string): boolean {
  let candidate = value;
  for (let pass = 0; pass < 2; pass += 1) {
    if (
      !candidate.startsWith("/")
      || candidate.startsWith("//")
      || candidate.includes("\\")
      || hasControlCharacters(candidate)
    ) return false;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return true;
      candidate = decoded;
    } catch {
      return false;
    }
  }
  return !candidate.startsWith("//") && !candidate.includes("\\");
}

/** Returns a same-origin application path, never an absolute or auth/API URL. */
export function safeAuthNextPath(value: string | null | undefined): string {
  if (!value || value.length > 2_048 || !decodedPathIsSafe(value)) return "/";
  try {
    const url = new URL(value, NEXT_URL_BASE);
    if (url.origin !== NEXT_URL_BASE || url.username || url.password) return "/";
    const blocked = BLOCKED_NEXT_PATHS.some(
      (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
    );
    return blocked ? "/" : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export const googleAuthStartInputSchema = z.object({
  next: z.string().max(2_048).optional(),
}).strict().transform((input) => ({ next: safeAuthNextPath(input.next) }));

export const googleAuthStartResponseSchema = apiSuccessSchema(z.object({
  authorizationUrl: z.string().url().startsWith("https://"),
}));

export const authClientUserSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().min(1).max(80),
  email: z.string().email(),
  emailVerified: z.literal(true),
  image: z.string().url().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const authClientSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1).max(512),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const authSessionDataSchema = z.union([
  z.object({ session: authClientSessionSchema, user: authClientUserSchema }),
  z.object({ session: z.null(), user: z.null() }),
]);

export const authSessionResponseSchema = apiSuccessSchema(authSessionDataSchema);
export const authLogoutResponseSchema = apiSuccessSchema(z.object({ signedOut: z.literal(true) }));

export type AuthClientUser = z.infer<typeof authClientUserSchema>;
export type AuthClientSession = z.infer<typeof authClientSessionSchema>;
export type AuthSessionData = z.infer<typeof authSessionDataSchema>;
