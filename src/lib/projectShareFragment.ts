let pendingProjectShareToken: string | null = null;

/**
 * Captures the bearer fragment before React, auth checks or analytics start.
 * The token stays only in this module's memory and is removed from the URL
 * immediately; it is never copied to storage, query parameters or headers.
 */
export function scrubProjectShareFragment(): void {
  if (
    typeof window === "undefined"
    || window.location.pathname.replace(/\/$/, "") !== "/delen"
  ) return;
  const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const match = /^toegang=([A-Za-z0-9_-]{43})$/.exec(fragment);
  pendingProjectShareToken = match?.[1] ?? null;
  window.history.replaceState(window.history.state, "", "/delen");
}

export function pendingProjectShareTokenValue(): string | null {
  return pendingProjectShareToken;
}

export function forgetPendingProjectShareToken(): void {
  pendingProjectShareToken = null;
}
