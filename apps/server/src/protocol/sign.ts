import { base64ToBytes, bytesToBase64 } from "../lib/encoding";

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

// Importing the key is the slow part; cache it per isolate, keyed by the PEM.
let cached: { pem: string; key: Promise<CryptoKey> } | undefined;

export function importPrivateKey(pem: string): Promise<CryptoKey> {
  if (cached?.pem === pem) return cached.key;
  const key = crypto.subtle.importKey("pkcs8", pemToPkcs8(pem), ALGORITHM, false, ["sign"]);
  cached = { pem, key };
  key.catch(() => {
    if (cached?.key === key) cached = undefined;
  });
  return key;
}

/** RSA-SHA256 over the UTF-8 body, base64-encoded, as expo-updates verifies it. */
export async function signBody(body: string, privateKeyPem: string): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(ALGORITHM, key, new TextEncoder().encode(body));
  return bytesToBase64(new Uint8Array(sig));
}

/** Structured-field dictionary for the `expo-signature` part header. */
export function expoSignatureHeader(sig: string, keyId: string): string {
  return `sig="${sig}", keyid="${keyId}"`;
}

/**
 * Converts a PEM private key to PKCS#8 DER. `expo-updates codesigning:generate`
 * writes PKCS#1 ("BEGIN RSA PRIVATE KEY"), which WebCrypto can't import
 * directly, so wrap it in a PrivateKeyInfo.
 */
export function pemToPkcs8(pem: string): Uint8Array {
  const match = pem.match(/-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/);
  if (!match) throw new Error("Invalid PEM private key");
  const [, label, body] = match;
  const der = base64ToBytes(body!);
  if (label === "PRIVATE KEY") return der;
  if (label === "RSA PRIVATE KEY") return wrapPkcs1(der);
  throw new Error(`Unsupported PEM type: ${label}`);
}

// AlgorithmIdentifier { rsaEncryption, NULL }
const RSA_ALGORITHM_ID = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

function wrapPkcs1(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const octetString = derTlv(0x04, pkcs1);
  return derTlv(0x30, concat(version, RSA_ALGORITHM_ID, octetString));
}

export function derTlv(tag: number, value: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), derLength(value.length), value);
}

function derLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  const bytes: number[] = [];
  for (let n = len; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
