import type { RuntimeConfig } from "../config/runtime.js";
import { AuthUnavailableError } from "./errors.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HTTPS_ONLY_ENVIRONMENTS = new Set(["preview", "staging", "production"]);
const TLS_DATABASE_MODES = new Set(["require", "verify-ca", "verify-full"]);

export interface AuthConfiguration {
  appOrigin: string;
  betaMode?: boolean;
  callbackUrl: string;
  databaseUrl: string;
  google: {
    clientId: string;
    clientSecret: string;
  };
  secureCookies: boolean;
  trustedOrigins: readonly string[];
}

function parseExactOrigin(rawValue: string, requireHttps: boolean): string {
  if (rawValue.includes("*")) throw new AuthUnavailableError("configuration_invalid");

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new AuthUnavailableError("configuration_invalid");
  }

  const isHttp = url.protocol === "http:";
  const isHttps = url.protocol === "https:";
  const hasOnlyOrigin =
    rawValue === url.origin &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;

  if (!hasOnlyOrigin || (!isHttp && !isHttps)) {
    throw new AuthUnavailableError("configuration_invalid");
  }

  if ((requireHttps || !LOOPBACK_HOSTS.has(url.hostname)) && !isHttps) {
    throw new AuthUnavailableError("configuration_invalid");
  }

  return url.origin;
}

function vercelOrigin(vercelUrl: string | undefined): string | undefined {
  if (!vercelUrl) return undefined;
  return vercelUrl.includes("://") ? vercelUrl : `https://${vercelUrl}`;
}

function validateDatabaseUrl(databaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new AuthUnavailableError("configuration_invalid");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new AuthUnavailableError("configuration_invalid");
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (!isLoopback && (!sslMode || !TLS_DATABASE_MODES.has(sslMode))) {
    throw new AuthUnavailableError("configuration_invalid");
  }
}

export function resolveAuthConfiguration(runtime: RuntimeConfig): AuthConfiguration {
  if (!runtime.DATABASE_URL || !runtime.GOOGLE_CLIENT_ID || !runtime.GOOGLE_CLIENT_SECRET) {
    throw new AuthUnavailableError("configuration_missing");
  }
  validateDatabaseUrl(runtime.DATABASE_URL);

  const requireHttps = HTTPS_ONLY_ENVIRONMENTS.has(runtime.APP_ENV);
  const appOrigin = parseExactOrigin(runtime.APP_ORIGIN, requireHttps);
  const primaryOrigin = runtime.PRIMARY_DOMAIN
    ? parseExactOrigin(runtime.PRIMARY_DOMAIN, true)
    : undefined;
  if (runtime.APP_ENV === "production" && (!primaryOrigin || primaryOrigin !== appOrigin)) {
    throw new AuthUnavailableError("configuration_invalid");
  }
  const configuredOrigins = runtime.TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
  const originCandidates = [appOrigin, primaryOrigin, vercelOrigin(runtime.VERCEL_URL), ...configuredOrigins];
  const trustedOrigins = Array.from(
    new Set(
      originCandidates
        .filter((origin): origin is string => Boolean(origin))
        .map((origin) => parseExactOrigin(origin, requireHttps)),
    ),
  );

  return {
    appOrigin,
    betaMode: runtime.BETA_MODE !== false,
    callbackUrl: new URL("/api/auth/callback/google", appOrigin).toString(),
    databaseUrl: runtime.DATABASE_URL,
    google: {
      clientId: runtime.GOOGLE_CLIENT_ID,
      clientSecret: runtime.GOOGLE_CLIENT_SECRET,
    },
    secureCookies: new URL(appOrigin).protocol === "https:",
    trustedOrigins,
  };
}
