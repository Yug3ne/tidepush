import {
  NULL,
  TRUE,
  bitString,
  children,
  explicit,
  integer,
  octetString,
  oid,
  readTlv,
  sequence,
  set,
  time,
  utf8String,
} from "../lib/der";
import { base64ToBytes, bytesToBase64, bytesToHex, sha256 } from "../lib/encoding";
import { ALGORITHM } from "./sign";

/**
 * Self-signed code-signing certificates, the same shape
 * `npx expo-updates codesigning:generate` makes: RSA-2048, SHA-256, the
 * digitalSignature key usage and the codeSigning extended key usage, both critical.
 */

const SHA256_WITH_RSA = sequence(oid("1.2.840.113549.1.1.11"), NULL);
const KEY_USAGE = "2.5.29.15";
const EXT_KEY_USAGE = "2.5.29.37";
const CODE_SIGNING = "1.3.6.1.5.5.7.3.3";

export const CERTIFICATE_YEARS = 10;

export function pemEncode(label: string, der: Uint8Array): string {
  const b64 = bytesToBase64(der)
    .replace(/(.{64})/g, "$1\n")
    .trimEnd();
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

export function pemDecode(pem: string, label: string): Uint8Array {
  const match = pem.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`));
  if (!match) throw new Error(`Expected a PEM ${label.toLowerCase()}`);
  return base64ToBytes(match[1]!);
}

const commonNameName = (cn: string) => sequence(set(sequence(oid("2.5.4.3"), utf8String(cn))));

const extension = (id: string, value: Uint8Array) => sequence(oid(id), TRUE, octetString(value));

export async function generateCodeSigningKey(
  commonName: string,
  now = new Date(),
): Promise<{ privateKey: CryptoKey; pkcs8: Uint8Array; certificatePem: string }> {
  const pair = (await crypto.subtle.generateKey(
    { ...ALGORITHM, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer);
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);

  const serial = crypto.getRandomValues(new Uint8Array(16));
  serial[0]! &= 0x7f;
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + CERTIFICATE_YEARS);
  const name = commonNameName(commonName.slice(0, 64) || "Tidepush app");

  const tbs = sequence(
    explicit(0, integer(new Uint8Array([2]))), // v3
    integer(serial),
    SHA256_WITH_RSA,
    name,
    sequence(time(now), time(notAfter)),
    name,
    spki,
    explicit(
      3,
      sequence(
        extension(KEY_USAGE, derBitStringDigitalSignature()),
        extension(EXT_KEY_USAGE, sequence(oid(CODE_SIGNING))),
      ),
    ),
  );
  const signature = new Uint8Array(await crypto.subtle.sign(ALGORITHM, pair.privateKey, tbs));
  const certificate = sequence(tbs, SHA256_WITH_RSA, bitString(signature));

  // Re-import as non-extractable for signing.
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, ALGORITHM, false, ["sign"]);
  return { privateKey, pkcs8, certificatePem: pemEncode("CERTIFICATE", certificate) };
}

/** KeyUsage ::= BIT STRING, with only digitalSignature (bit 0) set: 7 unused bits, 0x80. */
function derBitStringDigitalSignature(): Uint8Array {
  return new Uint8Array([0x03, 0x02, 0x07, 0x80]);
}

/** The certificate's public key, the way expo-updates reads it. */
export async function publicKeyFromCertificate(pem: string): Promise<CryptoKey> {
  const der = pemDecode(pem, "CERTIFICATE");
  const cert = readTlv(der, 0);
  const tbs = children(der, cert)[0]!;
  const fields = children(der, tbs);
  const offset = fields[0]!.tag === 0xa0 ? 1 : 0; // explicit [0] version
  const spki = fields[offset + 5];
  if (!spki) throw new Error("Malformed certificate");
  return crypto.subtle.importKey("spki", der.slice(spki.start, spki.end), ALGORITHM, false, ["verify"]);
}

/** SHA-256 of the certificate's DER, as hex: what people compare to tell certificates apart. */
export async function certificateFingerprint(pem: string): Promise<string> {
  return bytesToHex(await sha256(pemDecode(pem, "CERTIFICATE")));
}

/** True if `privateKey` signs what the certificate's public key verifies, i.e. they are a pair. */
export async function keyMatchesCertificate(privateKey: CryptoKey, certificatePem: string): Promise<boolean> {
  const probe = crypto.getRandomValues(new Uint8Array(32));
  const sig = await crypto.subtle.sign(ALGORITHM, privateKey, probe);
  return crypto.subtle.verify(ALGORITHM, await publicKeyFromCertificate(certificatePem), sig, probe);
}
