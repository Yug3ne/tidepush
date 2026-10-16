// End-to-end check of the hosted flow against locally running servers:
//   apps/server: npx wrangler dev --port 8787 --var TIDEPUSH_MODE:hosted
//   apps/web:    bun run dev            (http://localhost:3000)
// Run: node apps/web/e2e/flow.mjs   (CHROMIUM=/path/to/chromium if not /usr/bin/chromium)
import { spawn, spawnSync } from "node:child_process";
import { X509Certificate, createVerify } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const REPO = resolve(import.meta.dirname, "../../..");
const CLI = join(REPO, "packages/cli/src/index.ts");
const run = Date.now().toString(36);
const email = `e2e-${run}@example.com`;
const password = "e2e-test-password-123";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium" });
const page = await browser.newPage();
const step = (s) => console.log(`• ${s}`);
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
};
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

try {
  step("signed-out visit to a private page redirects to sign-in");
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.waitForURL(/\/login/);

  step(`sign up as ${email}`);
  await page.goto(`${WEB}/signup`, { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  step("onboarding: create an organization");
  await page.getByRole("heading", { name: "Name your organization" }).waitFor();
  await page.getByLabel("Organization name").fill(`E2E Org ${run}`);
  await page.getByRole("button", { name: "Continue" }).click();

  step("onboarding: create the first app");
  await page.getByRole("heading", { name: "Add your app" }).waitFor();
  await page.getByLabel("App name").fill("E2E App");
  await page.getByRole("button", { name: "Create app" }).click();
  await page.getByRole("heading", { name: "E2E App is ready" }).waitFor();
  const command = await page.locator(".command code").innerText();
  const appId = command.match(/--app (app_[a-z0-9]+)/)?.[1];
  if (!appId) throw new Error(`no app id in "${command}"`);
  console.log(`  app ${appId}`);

  step("dashboard: Updates is empty");
  await page.getByRole("button", { name: "Go to the dashboard" }).click();
  await page.getByText("No updates yet").waitFor();
  const orgId = new URL(page.url()).pathname.split("/")[1];
  console.log(`  org ${orgId}`);

  step("server-rendered: the Updates page HTML already contains its data");
  const html = await (await page.context().request.get(`${WEB}/${orgId}/${appId}`)).text();
  if (!html.includes("No updates yet")) fail("Updates page wasn't server-rendered with data");

  step("app settings: update URL and generated signing key");
  await page.getByRole("link", { name: "App settings" }).first().click();
  await page.getByText(`/${appId}/manifest`).first().waitFor();
  await page.getByRole("cell", { name: /main/ }).first().waitFor();

  step("settings: free plan, 1 of 1 app");
  await page.getByRole("link", { name: "Settings", exact: true }).first().click();
  await page.locator("#billing").getByText("Free", { exact: true }).waitFor();

  step("devices and audit log render");
  await page.getByRole("link", { name: "Devices" }).first().click();
  await page.getByRole("heading", { name: "Devices", exact: true }).waitFor();
  await page.getByRole("link", { name: "Audit log" }).first().click();
  await page.locator(".pill, span").getByText("App create", { exact: true }).first().waitFor();

  step("sign out, then back in");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(new RegExp(`/${orgId}/${appId}`));

  // ---- The CLI, against the same account -----------------------------------
  const work = await mkdtemp(join(tmpdir(), "tidepush-e2e-"));
  const cliEnv = { ...process.env, TIDEPUSH_CREDENTIALS: join(work, "credentials.json"), TIDEPUSH_WEB_URL: WEB };
  delete cliEnv.TIDEPUSH_TOKEN;
  delete cliEnv.TIDEPUSH_API_TOKEN;
  const cli = (args, cwd = work) => {
    const r = spawnSync("bun", [CLI, ...args], { cwd, env: cliEnv, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`tidepush ${args.join(" ")} failed:\n${r.stdout}${r.stderr}`);
    return r.stdout;
  };

  step("cli: login with the device flow, approved in the browser");
  const loginProc = spawn("bun", [CLI, "login", "--no-open"], { env: cliEnv });
  let loginOut = "";
  const loginDone = new Promise((ok, bad) => loginProc.on("exit", (code) => (code === 0 ? ok() : bad(new Error(`login exited ${code}: ${loginOut}`)))));
  loginProc.stdout.on("data", (d) => (loginOut += d));
  loginProc.stderr.on("data", (d) => (loginOut += d));
  for (let i = 0; i < 100 && !/Approve it at (\S+)/.test(loginOut); i++) await new Promise((r) => setTimeout(r, 100));
  const approveUrl = loginOut.match(/Approve it at (\S+)/)?.[1];
  if (!approveUrl) throw new Error(`no approval link in: ${loginOut}`);
  await page.goto(approveUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("heading", { name: "CLI approved" }).waitFor();
  await loginDone;
  if (!loginOut.includes(`Logged in as ${email}`)) fail(`unexpected login output: ${loginOut}`);

  step("cli: init writes the certificate and app.json");
  const appDir = join(work, "app");
  await mkdir(join(appDir, "node_modules/.bin"), { recursive: true });
  await writeFile(join(appDir, "package.json"), JSON.stringify({ name: "e2e-app", dependencies: { "expo-updates": "*" } }));
  await writeFile(join(appDir, "app.json"), JSON.stringify({ expo: { name: "E2E", slug: "e2e" } }));
  // Stands in for Expo's CLI: `expo config` prints the app config.
  const fakeExpo = join(appDir, "node_modules/.bin/expo");
  await writeFile(fakeExpo, `#!/usr/bin/env node\nconsole.log(JSON.stringify(require(${JSON.stringify(join(appDir, "app.json"))}).expo));\n`);
  await chmod(fakeExpo, 0o755);
  cli(["init", "--app", appId], appDir);
  const appJson = JSON.parse(await readFile(join(appDir, "app.json"), "utf8"));
  const updatesUrl = appJson.expo.updates.url;
  if (!updatesUrl.endsWith(`/${appId}/manifest`)) fail(`unexpected updates.url ${updatesUrl}`);
  const certificate = await readFile(join(appDir, "certs/certificate.pem"), "utf8");

  step("cli: publish an update (from a prepared export)");
  const dist = join(work, "dist");
  await mkdir(join(dist, "_expo/static/js/android"), { recursive: true });
  await writeFile(join(dist, "_expo/static/js/android/entry.hbc"), `bundle ${run}`);
  await writeFile(
    join(dist, "metadata.json"),
    JSON.stringify({ version: 0, bundler: "metro", fileMetadata: { android: { bundle: "_expo/static/js/android/entry.hbc", assets: [] } } }),
  );
  const published = cli(["publish", "--channel", "production", "--platform", "android", "--dist", dist, "--runtime-version", "rt-e2e", "-m", "e2e update"], appDir);
  if (!published.includes("Published to production")) fail(`unexpected publish output: ${published}`);

  step("phone: the update check returns the update, signed with the app's key");
  const res = await fetch(updatesUrl, {
    headers: {
      accept: "multipart/mixed",
      "expo-protocol-version": "1",
      "expo-platform": "android",
      "expo-runtime-version": "rt-e2e",
      "expo-channel-name": "production",
      "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
      "eas-client-id": `e2e-phone-${run}`,
    },
  });
  const text = await res.text();
  const part = text.split(/\r\n--/).find((p) => p.includes('name="manifest"'));
  if (res.status !== 200 || !part) throw new Error(`no manifest (${res.status}): ${text.slice(0, 300)}`);
  const sig = part.match(/expo-signature: sig="([^"]+)"/)?.[1];
  const body = part.slice(part.indexOf("\r\n\r\n") + 4);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(body);
  if (!sig || !verifier.verify(new X509Certificate(certificate).publicKey, sig, "base64")) fail("manifest signature didn't verify with the app's certificate");
  const manifest = JSON.parse(body);
  const bundle = await fetch(manifest.launchAsset.url);
  if ((await bundle.text()) !== `bundle ${run}`) fail("launch asset didn't download");

  step("dashboard: the update and the device show up");
  await page.goto(`${WEB}/${orgId}/${appId}`, { waitUntil: "networkidle" });
  await page.getByText("e2e update").first().waitFor();
  await page.goto(`${WEB}/${orgId}/settings#billing`, { waitUntil: "networkidle" });
  await page.locator("#billing tr", { hasText: "Monthly active devices" }).getByText("1", { exact: true }).waitFor();

  step("subscription flag: turning it on shows the Subscribed plan");
  const flag = spawnSync(join(REPO, "scripts/set-subscription.sh"), [orgId, "on", "--local"], { encoding: "utf8" });
  if (flag.status !== 0) throw new Error(`set-subscription failed: ${flag.stderr}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#billing").getByText("Subscribed", { exact: true }).waitFor();

  step("cli: logout forgets the session");
  cli(["logout"]);
  const after = spawnSync("bun", [CLI, "list", "--app", appId], { cwd: work, env: cliEnv, encoding: "utf8" });
  if (after.status === 0 || !after.stderr.includes("Not logged in")) fail(`list after logout: ${after.stdout}${after.stderr}`);

  console.log(process.exitCode ? "✖ finished with failures" : "✔ all steps passed");
  console.log(JSON.stringify({ email, password, orgId, appId }));
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
  await page.screenshot({ path: "/tmp/e2e-failure.png", fullPage: true });
  console.error("  screenshot: /tmp/e2e-failure.png");
} finally {
  await browser.close();
}
