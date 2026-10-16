// End-to-end check of the hosted flow against locally running servers:
//   apps/server: npx wrangler dev --port 8787 --var TIDEPUSH_MODE:hosted
//   apps/web:    bun run dev            (http://localhost:3000)
// Run: node apps/web/e2e/flow.mjs   (CHROMIUM=/path/to/chromium if not /usr/bin/chromium)
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
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

  console.log(process.exitCode ? "✖ finished with failures" : "✔ all steps passed");
  console.log(JSON.stringify({ email, password, orgId, appId }));
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
  await page.screenshot({ path: "/tmp/e2e-failure.png", fullPage: true });
  console.error("  screenshot: /tmp/e2e-failure.png");
} finally {
  await browser.close();
}
