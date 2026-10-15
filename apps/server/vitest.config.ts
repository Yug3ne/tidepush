import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import forge from "node-forge";
import { defineConfig } from "vitest/config";

/**
 * A throwaway signing key and self-signed certificate, generated per test run
 * the same way `expo-updates codesigning:generate` does (PKCS#1 key, X.509 cert),
 * so no private key ever lives in the repo.
 */
function generateCodeSigningFixture() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: "commonName", value: "Test" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "keyUsage", critical: true, digitalSignature: true },
    { name: "extKeyUsage", critical: true, codeSigning: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
  };
}

export default defineConfig(async () => {
  const fixture = generateCodeSigningFixture();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: await readD1Migrations("./migrations"),
            TEST_CERTIFICATE: fixture.certificatePem,
            CODE_SIGNING_PRIVATE_KEY: fixture.privateKeyPem,
            KEY_ENCRYPTION_KEY: forge.util.encode64(forge.random.getBytesSync(32)),
            SETUP_TOKEN: "test-setup-token-0123456789abcdef0123456789",
            // The second entry is too short (< 32 chars) and must be ignored.
            ADMIN_API_TOKENS: "env-break-glass-token-0123456789abcdef, short-token-0123",
            ACCESS_TEAM_DOMAIN: "tidepush-test.cloudflareaccess.com",
            ACCESS_AUD: "test-aud",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
