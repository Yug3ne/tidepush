import type { Env } from "./env";
import { base64ToBytes, bytesToBase64Url } from "./lib/encoding";
import { HttpError } from "./lib/http";

/**
 * An app's build-time variables: names, limits and encryption at rest.
 *
 * Only EXPO_PUBLIC_* names are accepted. The CLI passes these to `expo export`
 * as environment variables on the machine that publishes, so a name like PATH
 * or NODE_OPTIONS would let whoever can write here run code on every
 * publisher's machine.
 */
export const ENV_VAR_NAME = /^EXPO_PUBLIC_[A-Za-z0-9_]{1,100}$/;
export const MAX_ENV_VALUE_LENGTH = 4096;
/** Per app and channel scope. */
export const MAX_ENV_VARS = 100;

/** How "every channel" is stored (channel names can't be empty). */
export const ALL_CHANNELS = "";

// ---- Encryption at rest -------------------------------------------------------

let keyCache: { secret: string; key: Promise<CryptoKey> } | undefined;

/**
 * The AES-256-GCM key for variable values, derived (HKDF-SHA256) from
 * KEY_ENCRYPTION_KEY so it is never the same key that wraps signing keys.
 * Null if KEY_ENCRYPTION_KEY isn't set.
 */
export function envVarKey(env: Env): Promise<CryptoKey> | null {
  const secret = env.KEY_ENCRYPTION_KEY;
  if (!secret) return null;
  if (keyCache?.secret !== secret) {
    const raw = base64ToBytes(secret.trim());
    if (raw.length !== 32) throw new Error("KEY_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    const key = crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]).then((master) =>
      crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: new Uint8Array(0),
          info: new TextEncoder().encode("tidepush:app-env-vars:v1"),
        },
        master,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ),
    );
    keyCache = { secret, key };
  }
  return keyCache.key;
}

export function requireEnvVarKey(env: Env): Promise<CryptoKey> {
  const key = envVarKey(env);
  if (!key) {
    throw new HttpError(
      503,
      "Environment variables are disabled: set the KEY_ENCRYPTION_KEY secret (32 random bytes, base64) on the Worker.",
    );
  }
  return key;
}

export interface EnvVarSlot {
  appId: string;
  channel: string;
  name: string;
}

// Names and channels can't contain a newline, so the three parts can't run into each other.
const additionalData = (s: EnvVarSlot) => new TextEncoder().encode(`${s.appId}\n${s.channel}\n${s.name}`);

export async function encryptEnvValue(key: CryptoKey, value: string, slot: EnvVarSlot): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(slot) },
    key,
    new TextEncoder().encode(value),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ct))}`;
}

export async function decryptEnvValue(key: CryptoKey, enc: string, slot: EnvVarSlot): Promise<string> {
  const [version, iv, ct] = enc.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Unknown environment variable encoding");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv), additionalData: additionalData(slot) },
    key,
    base64ToBytes(ct),
  );
  return new TextDecoder().decode(plain);
}
