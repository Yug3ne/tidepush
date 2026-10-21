// Smoke test against a deployed web app, with a real account. Read-only except for one CLI
// session (logged out at the end).
//   WEB_URL=https://… SMOKE_EMAIL=… SMOKE_PASSWORD=… node e2e/smoke.mjs
// Optional: SMOKE_APP=app_xxx (an app id to look for), CLI_BUILD=1 (use the Node bundle).
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL;
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
if (!WEB || !email || !password) throw new Error("Set WEB_URL, SMOKE_EMAIL and SMOKE_PASSWORD");
const REPO = resolve(import.meta.dirname, "../../..");
const CLI = process.env.CLI_BUILD
  ? ["node", join(REPO, "packages/cli/dist/index.js")]
  : ["bun", join(REPO, "packages/cli/src/index.ts")];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium" });
const page = await browser.newPage();
const step = (s) => console.log(`• ${s}`);
page.on("pageerror", (e) => {
  console.error(`✖ page error: ${e.message}`);
  process.exitCode = 1;
});

try {
  step("sign in");
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/org_[a-z0-9_]+\/app_[a-z0-9_]+/, { timeout: 30_000 });
  const [, orgId, appId] = new URL(page.url()).pathname.split("/");
  console.log(`  ${orgId} / ${appId}`);

  step("Updates page is server-rendered with data");
  const html = await (await page.context().request.get(`${WEB}/${orgId}/${appId}`)).text();
  const updates = await page.locator("table tbody tr").count();
  console.log(`  ${updates} update rows; SSR html ${html.length} bytes`);
  if (!updates && !html.includes("No updates yet"))
    throw new Error("Updates page shows neither updates nor the empty state");

  step("app settings, settings, devices, audit render");
  for (const path of [
    `/${orgId}/${appId}/settings`,
    `/${orgId}/settings`,
    `/${orgId}/${appId}/devices`,
    `/${orgId}/audit`,
  ]) {
    const res = await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" });
    if (res?.status() !== 200) throw new Error(`${path} answered ${res?.status()}`);
    await page.locator("main h1").first().waitFor();
  }
  await page.goto(`${WEB}/${orgId}/settings#billing`, { waitUntil: "networkidle" });
  await page
    .locator("#billing")
    .getByText(/Free|Subscribed|Self-hosted/)
    .first()
    .waitFor();

  step("CLI: device login approved in the browser, then list");
  const work = await mkdtemp(join(tmpdir(), "tidepush-smoke-"));
  const env = { ...process.env, TIDEPUSH_CREDENTIALS: join(work, "credentials.json"), TIDEPUSH_WEB_URL: WEB };
  delete env.TIDEPUSH_TOKEN;
  delete env.TIDEPUSH_API_TOKEN;
  const proc = spawn(CLI[0], [CLI[1], "login", "--no-open"], { env });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (out += d));
  const done = new Promise((ok, bad) =>
    proc.on("exit", (c) => (c === 0 ? ok() : bad(new Error(`login exited ${c}: ${out}`)))),
  );
  for (let i = 0; i < 150 && !/Approve it at (\S+)/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
  const link = out.match(/Approve it at (\S+)/)?.[1];
  if (!link) throw new Error(`no approval link: ${out}`);
  await page.goto(link, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("heading", { name: "CLI approved" }).waitFor();
  await done;
  const list = spawnSync(CLI[0], [CLI[1], "list", "--app", appId], { env, encoding: "utf8" });
  if (list.status !== 0) throw new Error(`list failed: ${list.stdout}${list.stderr}`);
  console.log(
    list.stdout
      .split("\n")
      .slice(0, 6)
      .map((l) => `  ${l}`)
      .join("\n"),
  );
  spawnSync(CLI[0], [CLI[1], "logout"], { env, encoding: "utf8" });

  console.log(process.exitCode ? "✖ finished with failures" : "✔ smoke test passed");
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
  await page.screenshot({ path: "/tmp/smoke-failure.png", fullPage: true });
  console.error("  screenshot: /tmp/smoke-failure.png");
} finally {
  await browser.close();
}
