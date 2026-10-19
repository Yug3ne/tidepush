// End-to-end check of a fresh self-hosted server against locally running servers:
//   scripts/dev-vars.sh                                      (prints the setup token)
//   bun run --filter @tidepush/server db:migrate:local      (on an EMPTY local database)
//   bun run dev                                              (API on :8787, web app on :3000)
// Run: SETUP_TOKEN=setup-… node apps/web/e2e/selfhost.mjs   (CHROMIUM=/path/to/chromium if not /usr/bin/chromium)
// It creates the first owner, so it only passes once per database.
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://localhost:8787";
const SETUP_TOKEN = process.env.SETUP_TOKEN;
if (!SETUP_TOKEN) throw new Error("Set SETUP_TOKEN (it's in apps/server/.dev.vars).");
const run = Date.now().toString(36);
const owner = { name: "Self Owner", email: `owner-${run}@example.com`, password: "self-host-owner-pw-123" };
const invitee = { name: "Invited Person", email: `invitee-${run}@example.com`, password: "self-host-invitee-pw-1" };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium" });
const step = (s) => console.log(`• ${s}`);
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
};

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => fail(`page error: ${e.message}`));

  step("the API Worker has no dashboard and no public account routes");
  for (const path of ["/", "/settings", "/auth/status"]) {
    const res = await fetch(`${API}${path}`, { redirect: "manual" });
    if (res.status !== 404 && !(path === "/" && res.status === 302)) fail(`${API}${path} answered ${res.status}`);
  }

  step("a fresh server sends you to /setup");
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.waitForURL(/\/setup$/);

  step("setup refuses a wrong token");
  await page.getByLabel("Setup token").fill("not-the-token");
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await page.getByText("Invalid setup token").waitFor();

  step("setup creates the first owner and signs them in");
  await page.getByLabel("Setup token").fill(SETUP_TOKEN);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await page.waitForURL(/\/org_default\//);
  await page.getByText("No updates yet").waitFor();

  step("setup is closed now");
  const again = await browser.newPage();
  await again.goto(`${WEB}/setup`, { waitUntil: "networkidle" });
  await again.waitForURL(/\/login/);
  await again.getByText("Ask an owner of this server for an invite link").waitFor();

  step("sign-up is closed: the page says so, and Better Auth refuses");
  await again.goto(`${WEB}/signup`, { waitUntil: "networkidle" });
  await again.getByRole("heading", { name: "Sign-up is closed" }).waitFor();
  const signUp = await fetch(`${WEB}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB },
    body: JSON.stringify({ name: "Stranger", email: `stranger-${run}@example.com`, password: "stranger-password-1" }),
  });
  if (signUp.status !== 403) fail(`sign-up answered ${signUp.status}, expected 403`);
  await again.close();

  step("the owner invites someone from Settings");
  await page.goto(`${WEB}/org_default/settings`, { waitUntil: "networkidle" });
  const team = page.locator("#team");
  await team.getByLabel("Email").fill(invitee.email);
  await team.getByRole("button", { name: "Create invite link" }).click();
  const inviteUrl = await page.getByRole("textbox", { name: "Invite link" }).inputValue();
  if (!inviteUrl.startsWith(`${WEB}/invite/`)) fail(`invite link points elsewhere: ${inviteUrl}`);

  step("the invitee creates their account on the invite page and lands in the org");
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  guestPage.on("pageerror", (e) => fail(`page error: ${e.message}`));
  await guestPage.goto(inviteUrl, { waitUntil: "networkidle" });
  await guestPage.getByRole("heading", { name: "Join Default" }).waitFor();
  await guestPage.getByLabel("Your name").fill(invitee.name);
  await guestPage.getByLabel("Password", { exact: true }).fill(invitee.password);
  await guestPage.getByRole("button", { name: "Create account and join" }).click();
  await guestPage.waitForURL(/\/org_default/);

  step("the invite link is spent");
  await guestPage.goto(inviteUrl, { waitUntil: "networkidle" });
  await guestPage.getByText("already been used").waitFor();

  step("the invitee signs out and back in with that password");
  await guestPage.goto(`${WEB}/org_default/settings`, { waitUntil: "networkidle" });
  await guestPage.getByRole("button", { name: "Sign out" }).first().click();
  await guestPage.waitForURL(/\/login/);
  await guestPage.getByLabel("Email").fill(invitee.email);
  await guestPage.getByLabel("Password", { exact: true }).fill(invitee.password);
  await guestPage.getByRole("button", { name: "Sign in" }).click();
  await guestPage.waitForURL(/\/org_default/);
  await guest.close();

  step("the owner sees them on the team");
  await page.goto(`${WEB}/org_default/settings`, { waitUntil: "networkidle" });
  await team.getByText(invitee.email).waitFor();

  if (!process.exitCode) console.log("✔ self-hosted flow passed");
} catch (e) {
  fail(e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  await browser.close();
}
