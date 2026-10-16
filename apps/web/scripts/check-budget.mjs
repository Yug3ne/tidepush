// Fails the build if a key page's initial JavaScript (gzipped) is over budget.
// Run after `vite build`: node scripts/check-budget.mjs [--verbose]
//
// A page's initial JS is what its server-rendered HTML preloads: the root's
// chunks plus every route from the root down to the page (from TanStack
// Start's build manifest), each counted once.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// React 19 + TanStack Router, Query and Start's RPC layer alone are ~115 KB; this leaves room for app code
// and fails on regressions (a schema library or auth client sneaking into the browser, a heavy view not lazy-loaded).
const BUDGET_KB = 140;
const PAGES = {
  "Sign in": "/login",
  "Sign up": "/signup",
  Updates: "/_authed/$orgId/$appId/",
  Devices: "/_authed/$orgId/$appId/devices",
  Settings: "/_authed/$orgId/settings",
  Onboarding: "/_authed/onboarding",
};

const root = new URL("..", import.meta.url).pathname;
const assets = join(root, "dist/server/assets");
const file = readdirSync(assets).find((f) => f.startsWith("_tanstack-start-manifest") && f.endsWith(".js"));
if (!file) throw new Error("No TanStack Start manifest in dist/server/assets. Run `vite build` first.");
// The manifest module defines `tsrStartManifest`; load it and call it.
const source = readFileSync(join(assets, file), "utf8");
const { routes } = (await import(`data:text/javascript,${encodeURIComponent(`${source}\nexport default tsrStartManifest;`)}`)).default();

const parentOf = {};
for (const [id, r] of Object.entries(routes)) for (const child of r.children ?? []) parentOf[child] = id;

const gz = new Map();
const size = (asset) => {
  if (!gz.has(asset)) gz.set(asset, gzipSync(readFileSync(join(root, "dist/client", asset))).byteLength);
  return gz.get(asset);
};

let failed = false;
for (const [name, id] of Object.entries(PAGES)) {
  if (!routes[id]) throw new Error(`Route ${id} isn't in the manifest`);
  const chunks = new Set();
  for (let r = id; r; r = parentOf[r]) for (const p of routes[r].preloads ?? []) if (p.endsWith(".js")) chunks.add(p);
  const kb = [...chunks].reduce((n, c) => n + size(c), 0) / 1024;
  const ok = kb <= BUDGET_KB;
  failed ||= !ok;
  console.log(`${ok ? "✔" : "✖"} ${name.padEnd(11)} ${kb.toFixed(1).padStart(6)} KB gzipped JS (${chunks.size} files, budget ${BUDGET_KB} KB)`);
  if (process.argv.includes("--verbose")) {
    for (const c of [...chunks].sort((x, y) => size(y) - size(x))) console.log(`    ${(size(c) / 1024).toFixed(1).padStart(6)} ${c}`);
  }
}
if (failed) {
  console.error(`Over budget. Lazy-load heavy views, or justify the dependency (see plans/hosted-multitenant.md).`);
  process.exit(1);
}
