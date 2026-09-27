import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Versioned, salted scrypt; Node's built-in implementation avoids an auth dependency.
const COST = 131_072;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const PREFIX = `scrypt$v1$${COST}$${BLOCK_SIZE}$${PARALLELISM}$`;
const DUMMY_HASH = `${PREFIX}${"00".repeat(16)}$${"00".repeat(KEY_BYTES)}`;
let activeDerivations = 0;

const COMMON_PASSWORDS = new Set([
  "password123456789", "password12345678", "passwordpassword", "passwordpasswordpassword",
  "123456789012345", "1234567890123456", "12345678901234567890", "qwertyuiopasdfgh",
  "qwertyuiopasdfghjkl", "wachtwoord123456", "wachtwoordwachtwoord",
  "iloveyouiloveyou", "letmeinletmeinletmein", "correct horse battery staple",
]);

export function isWeakPassword(password: string, username: string): boolean {
  const normalized = password.normalize("NFKC").toLowerCase().trim();
  return COMMON_PASSWORDS.has(normalized)
    || /^(.)\1+$/u.test(normalized)
    || normalized === username
    || normalized === username.repeat(Math.ceil(normalized.length / username.length)).slice(0, normalized.length);
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  // Bound concurrent memory use per instance, including requests with unknown usernames.
  if (activeDerivations >= 2) throw new Error("password_capacity_exceeded");
  activeDerivations += 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, KEY_BYTES, {
        N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: 256 * 1_024 * 1_024,
      }, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    activeDerivations -= 1;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${PREFIX}${salt.toString("hex")}$${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const candidate = encoded ?? DUMMY_HASH;
  const valid = candidate.startsWith(PREFIX)
    && /^[0-9a-f]{32}\$[0-9a-f]{128}$/.test(candidate.slice(PREFIX.length));
  const [salt, expected] = (valid ? candidate : DUMMY_HASH).slice(PREFIX.length).split("$");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  const matches = timingSafeEqual(actual, Buffer.from(expected, "hex"));
  return encoded !== null && valid && matches;
}
