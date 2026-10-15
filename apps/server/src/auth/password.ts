import { base64ToBytes, bytesToBase64Url } from "../lib/encoding";

/**
 * Password hashing: PBKDF2-SHA256 via WebCrypto. 100000 iterations is the most
 * Workers allows. Stored as `pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>`.
 */
const ITERATIONS = 100_000;
const SCHEME = "pbkdf2-sha256";

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `${SCHEME}$${ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  const iterations = Number(iter);
  if (scheme !== SCHEME || !saltB64 || !hashB64 || !Number.isInteger(iterations)) return false;
  if (iterations < 1 || iterations > ITERATIONS) return false;
  const expected = base64ToBytes(hashB64);
  const actual = await derive(password, base64ToBytes(saltB64), iterations);
  return expected.byteLength === actual.byteLength && crypto.subtle.timingSafeEqual(expected, actual);
}

// A real hash to verify against when the email doesn't exist, so unknown and
// known emails take the same time.
let dummyHash: Promise<string> | undefined;

export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= hashPassword("tidepush-dummy-password");
  await verifyPassword(password, await dummyHash);
  return false;
}
