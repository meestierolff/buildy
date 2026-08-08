const SAFE_NAMESPACE = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * Creates an opaque browser command key. Callers retain the returned value for
 * every retry of the same payload; a changed payload must receive a new key.
 */
export function createClientIdempotencyKey(namespace: string): string {
  if (!SAFE_NAMESPACE.test(namespace)) {
    throw new Error("De idempotency-namespace is ongeldig.");
  }
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Deze browser kan geen veilige opdracht-ID maken.");
  }
  return `${namespace}:${globalThis.crypto.randomUUID()}`;
}
