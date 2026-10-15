import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../src/lib/encoding";
import { expoSignatureHeader, pemToPkcs8, signBody } from "../src/protocol/sign";
import { verifyWithCertificate } from "./helpers";

describe("signing", () => {
  it("signs with a PKCS#1 key from expo-updates and verifies against the app certificate", async () => {
    expect(env.CODE_SIGNING_PRIVATE_KEY).toContain("BEGIN RSA PRIVATE KEY");
    const body = JSON.stringify({ id: "x", hello: "wörld" });
    const header = expoSignatureHeader(await signBody(body, env.CODE_SIGNING_PRIVATE_KEY!), "main");
    expect(header).toMatch(/^sig="[A-Za-z0-9+/=]+", keyid="main"$/);
    expect(await verifyWithCertificate(body, header)).toBe(true);
  });

  it("fails verification for a tampered body", async () => {
    const header = expoSignatureHeader(await signBody('{"a":1}', env.CODE_SIGNING_PRIVATE_KEY!), "main");
    expect(await verifyWithCertificate('{"a":2}', header)).toBe(false);
  });

  it("accepts PKCS#8 keys too", async () => {
    const pkcs8 = pemToPkcs8(env.CODE_SIGNING_PRIVATE_KEY!);
    const pem = `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8)}\n-----END PRIVATE KEY-----`;
    const header = expoSignatureHeader(await signBody("body", pem), "main");
    expect(await verifyWithCertificate("body", header)).toBe(true);
  });

  it("rejects non-key PEMs", () => {
    expect(() => pemToPkcs8("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----")).toThrow();
  });
});
