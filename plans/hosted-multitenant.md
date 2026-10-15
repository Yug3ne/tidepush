# Plan: hosted, multi-tenant Tidepush

Internal planning doc. Not published on the docs site.

## Goal

Sell Tidepush as a hosted service (sign up, create an app, ship OTA updates) while keeping the
open-source, self-hostable version. One codebase serves both:

- **Hosted mode:** public sign-up, many organizations, many apps, billing.
- **Self-hosted mode:** exactly today's experience. One organization is created on first-run setup;
  there is no public sign-up and no billing.

The current single-tenant build on `main` stays deployed, unchanged, as the test environment
until phase 1 lands. Nothing in this plan may break builds that already point at it (see
"Compatibility").

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Tenancy | Shared multi-tenant: one deployment, every row scoped to an org or app | Cheapest to run and simplest to operate. Per-customer deployments get expensive to maintain past a few dozen customers. |
| Open core? | No. Hosted runs the same AGPL code. We sell convenience. | Maintain one product, not two, and keep community trust. Paid extras (SSO, longer audit retention) come later and only on request. |
| Pricing basis | Monthly active devices (MAD) per org | Matches how EAS prices, so buyers already understand it, and it tracks value. |
| Signing keys (hosted) | Generated per app by us, stored encrypted. Owners can export the private key. BYO key upload supported. | Keeps sign-up to minutes. Export removes lock-in fears and gives customers a way to move to self-hosting. |
| First customer | Indie devs and small teams, card payments, self-serve | Fast decisions, no sales cycle, already put off by EAS pricing |
| Login | GitHub OAuth first, email + password kept (it already exists) | GitHub covers almost all of the audience. |
| Web app | TanStack Start (latest, 1.169.x at the time of writing), React 19, deployed as its own Worker | Server rendering, typed routes and loaders, and server functions, without a separate backend for the frontend. See "Web app". |
| Docs site | Stays on VitePress | It's already a static, fast site. Moving it gains nothing. |

Placeholder domains used in the docs branch (replace in one pass once bought):

- Web app (dashboard, sign-up, billing): `https://app.tidepush.dev`
- Update server (phones): `https://u.tidepush.dev/<appId>/manifest`
- Admin API (CLI, CI, web app): `https://api.tidepush.dev`
- Docs: `https://tidepush.dev`

## Data model

New tables (migration `0003_tenancy.sql`):

```sql
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,               -- org_…
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free', -- free | pro | team | selfhost
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE apps (
  id TEXT PRIMARY KEY,               -- app_… public, appears in updates.url
  org_id TEXT NOT NULL REFERENCES orgs (id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX apps_org ON apps (org_id);

-- Encrypted with a KEK held in a Worker secret (AES-GCM, per-row IV).
CREATE TABLE signing_keys (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps (id),
  key_id TEXT NOT NULL,              -- codeSigningMetadata.keyid, default 'main'
  private_key_enc BLOB NOT NULL,
  certificate_pem TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('generated', 'uploaded')),
  created_at TEXT NOT NULL,
  retired_at TEXT,
  UNIQUE (app_id, key_id)
);

CREATE TABLE memberships (
  org_id TEXT NOT NULL REFERENCES orgs (id),
  user_id TEXT NOT NULL REFERENCES admins (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE oauth_identities (
  provider TEXT NOT NULL,            -- 'github'
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES admins (id),
  PRIMARY KEY (provider, provider_user_id)
);

-- One row per device per app per month; COUNT(*) is the billable MAD.
CREATE TABLE device_months (
  app_id TEXT NOT NULL,
  month TEXT NOT NULL,               -- 'YYYY-MM'
  client_id TEXT NOT NULL,
  PRIMARY KEY (app_id, month, client_id)
);
```

Changes to existing tables:

| Table | Change |
| --- | --- |
| `updates` | `app_id` NOT NULL (backfilled). Index becomes `(app_id, channel, platform, runtime_version, created_at DESC)`. |
| `devices` | Primary key becomes `(app_id, client_id)`. |
| `assets` | `app_id` added; primary key `(app_id, key)`. R2 key becomes `apps/<appId>/<sha256>`. No cross-tenant dedupe. |
| `update_assets` | Unchanged (update ids are global). |
| `audit_log` | `org_id`, `app_id` (nullable). |
| `api_tokens` | `org_id` NOT NULL, optional `app_id` to restrict a token to one app. |
| `invites` | `org_id` NOT NULL. |
| `admins` | Becomes "users". Its `role` moves to `memberships`. Kept as a column for one release, then dropped. |

D1 has no `ALTER TABLE … ADD PRIMARY KEY`, so `devices` and `assets` are rebuilt
(create new, copy, drop, rename) inside the migration.

**Backfill:** the migration creates one org (`org_default`) and one app (`app_default`). Every
existing row is assigned to them, and every existing admin becomes a member with their current
role. The existing `CODE_SIGNING_PRIVATE_KEY` secret is imported as the default app's key on
first boot (the secret can't be read from SQL).

**Scaling path, not needed now:** a single D1 database is fine to start. When it gets close to
D1's size limits, move each app's update and device data into a SQLite-backed Durable Object
(keyed by app id), keeping orgs, users and billing in D1.

## URLs and routing

| Path | Purpose |
| --- | --- |
| `GET /:appId/manifest` | Update check. The app id comes from `updates.url`. |
| `GET /:appId/assets/:key` | Asset download, cached at the edge for a year. |
| `GET /manifest`, `GET /assets/:key` | Kept and mapped to `app_default` forever, for builds already in the field. |
| `/admin/apps/:appId/...` | App-scoped admin API (updates, channels, stats, devices, keys) |
| `/admin/orgs/:orgId/...` | Org-scoped admin API (members, invites, tokens, billing, apps) |
| `/auth/*` | Token exchange for the CLI device-login. Browser login lives in the web app. |

`/:appId/*` is served on `u.tidepush.dev`; `/admin/*` and `/auth/*` on `api.tidepush.dev`. Both
hostnames point at the same API Worker, and each hostname only routes its own paths.

Authorization is checked once in middleware: resolve the caller, resolve the org that owns the
`appId` or `orgId` in the path, and require a membership with a sufficient role (or a token
belonging to that org, and to that app if the token is app-restricted). A wrong tenant returns
`404`, not `403`, so ids can't be probed.

Roles:

| Role | Can |
| --- | --- |
| owner | Everything, including billing, members, deleting apps, exporting signing keys |
| admin | Publish, promote, rollout, rollback, manage apps and API tokens |
| member | Read-only: updates, devices, audit log |

## Web app (TanStack Start)

A new `apps/web`, built with TanStack Start, replaces `apps/dashboard` (React + Vite SPA). The
old dashboard stays and keeps being served by the current Worker until the new app reaches
parity, so the deployment from `main` remains usable for testing the whole time.

### Shape

```
browser ──▶ app.tidepush.dev   tidepush-web Worker (TanStack Start: SSR, server functions)
                                   │ service binding (RPC, no public network hop)
phones  ──▶ u.tidepush.dev  ─┐     ▼
CLI/CI  ──▶ api.tidepush.dev ┴──▶ tidepush-api Worker (Hono: protocol + admin API) ──▶ D1, R2
```

- **Two Workers.** The update path that phones hit stays a small Hono Worker with no UI code, so
  its cold starts and bundle size don't grow with the dashboard. The web app is a separate Worker
  and can be deployed independently.
- **The web app is a backend-for-frontend.** The browser only talks to `app.tidepush.dev`.
  Server functions check the session cookie and call the API Worker over a service binding,
  passing the verified user and org. No CORS, no token in the browser, and the admin API never
  needs to accept cookies from another origin.
- **Sessions live with the web app.** The session cookie is set on `app.tidepush.dev`. The API
  Worker trusts identity only from the service binding (never from a public header). The CLI and
  CI keep using `tp_…` tokens against `api.tidepush.dev`.

### Performance ("fast as hell")

Budgets, enforced in CI (bundle size check, plus Lighthouse on the main routes against a preview deploy):

| Metric | Budget |
| --- | --- |
| Initial JS on any route, gzipped | ≤ 120 KB |
| TTFB of server-rendered pages, p75 | ≤ 200 ms |
| LCP on the Updates page, p75, mid-range phone on 4G | ≤ 1.5 s |
| Client-side route change with preloaded data | ≤ 100 ms, no spinner |
| INP | ≤ 100 ms |

How we hit them:

1. **Data comes with the HTML.** Every route loads its data in a route `loader` (via TanStack
   Query `ensureQueryData`) on the server, so the first paint shows real data. Avoid
   fetch-on-mount waterfalls.
2. **Preload on intent.** Set the router's `defaultPreload: "intent"`, so hovering or touching a
   link loads that route's code and data before the click. Set `defaultPreloadStaleTime: 0`
   and let TanStack Query decide when cached data is stale.
3. **Automatic code splitting** per route. Heavy, rarely used views (charts, billing, key
   export) are lazy and never in the first bundle.
4. **No heavy UI kit.** Keep the existing design tokens and CSS from `apps/dashboard`. No
   CSS-in-JS runtime, no component library, no moment/lodash-sized dependencies. Each new
   dependency has to justify its size in the PR.
5. **Few database round trips per page.** Each loader makes one call to the API Worker, which
   answers with one batched D1 query (`db.batch`). Page data shouldn't need several sequential
   queries.
6. **Read replicas.** Use the D1 Sessions API for dashboard reads, so they're served by a nearby
   replica, with session bookmarks so users always see their own writes.
7. **Caching.** Hashed static assets are immutable and cached for a year. Server-rendered
   HTML is `private, no-store`, because it's per-user.
8. **Streaming.** Slow, non-critical panels (adoption charts, audit tail) are deferred and
   streamed in after the shell renders.
9. **Optimistic updates** for rollout changes, promote and rollback, rolled back on error.

### Routes (first cut)

| Route | Content |
| --- | --- |
| `/login`, `/signup`, `/auth/github/callback` | Sign-in and sign-up |
| `/cli/approve` | Approves `tidepush login` (device-code flow) |
| `/onboarding` | Create org and first app, copy `updates.url`, download the certificate, run `npx tidepush init` |
| `/:org` | App list and usage summary |
| `/:org/:app/updates` | Today's Updates page (publish history, rollout, promote, rollback) |
| `/:org/:app/devices` | Today's Devices page |
| `/:org/:app/settings` | App name, code signing (download certificate, upload, export, rotate) |
| `/:org/settings/members`, `/tokens`, `/billing`, `/audit` | Org administration |
| `/setup`, `/invite/:token` | Self-host first-run setup, and invite acceptance |

## Signing keys

- On app creation, the Worker generates an RSA-2048 key and a self-signed certificate valid for
  10 years, in the same format as `expo-updates codesigning:generate`. The dashboard and CLI
  show and download `certificate.pem`.
- Private keys are encrypted with `KEY_ENCRYPTION_KEY` (a Worker secret, 32 bytes). Plaintext
  exists only in memory while signing.
- Cache imported `CryptoKey`s per isolate, keyed by app id, to avoid decrypting and importing on
  every manifest request.
- BYO: owners can upload a PEM instead. Export: owners re-authenticate and download the PEM.
  Both actions are audited.
- Rotation: add a second key with a new `key_id`. Each build signals the key it trusts, so old
  and new builds keep working during the switch. (The current "one key at a time" limit goes away.)

## CLI

Goal: `npx tidepush` works from inside the app directory with nothing else installed.

- Publish `@tidepush/cli` to npm, built to Node-compatible JS (it currently runs TypeScript
  directly under Bun).
- `tidepush login`: device-code flow. Opens `app.tidepush.dev/cli/approve`, which approves the CLI. Stores a
  token in `~/.config/tidepush/credentials.json`. CI keeps using `TIDEPUSH_TOKEN`.
- `tidepush init`: pick or create an app, then write `updates.url`, `codeSigningCertificate`,
  `codeSigningMetadata` and `runtimeVersion` into `app.json`, and save `certs/certificate.pem`.
- The app id is read from `updates.url` in the app config, so no extra config file is needed.
  `--app <id>` overrides it.
- Self-hosted: `TIDEPUSH_SERVER_URL` still works and overrides the default
  `https://api.tidepush.dev`. `TIDEPUSH_API_TOKEN` is accepted as an alias of `TIDEPUSH_TOKEN`.
- Existing commands (`publish`, `promote`, `rollout`, `rollback`, `list`) are unchanged apart
  from being scoped to the app.

## Billing and limits

- Count each `(app_id, month, client_id)` once in `device_months` with `INSERT OR IGNORE`, using
  the `waitUntil` path that already records devices. MAD is the count across an org's apps.
- Stripe Checkout and the customer portal. A webhook updates `orgs.plan`.
- Over the limit: **never stop serving updates to phones.** Show a warning in the dashboard,
  then block *publishing* after a 7-day grace period. Stopping updates to phones would punish the
  customer's users.
- Per-plan limits: MAD, apps, members, asset size, audit retention.
- Proposed tiers (to validate): Free with 1,000 MAD and 1 app; Pro and Team priced clearly below
  EAS Update at the same MAD.
- Cost guardrails: per-org rate limits on `/admin/*` uploads; storage per app; prune assets
  not referenced by any update older than N days (also an R2 lifecycle sweep).

## Self-hosted mode

`TIDEPUSH_MODE=selfhost` (the default when unset, so existing deployments don't change):

- `/setup` with `SETUP_TOKEN` creates the user **and** the single org, as today.
- Sign-up, billing and plan limits are switched off. The org has plan `selfhost`.
- Creating more apps is allowed. Self-hosters get multi-app support for free.
- Self-hosters deploy the same two Workers (API and web). A single-hostname setup, with the web
  app on `/` and the API on `/api`, should stay possible for people who only want one domain.

`TIDEPUSH_MODE=hosted` enables sign-up, GitHub OAuth, Stripe and limits.

Self-hosting instructions move out of the public docs into the repository
(`docs/self-hosting/`), so they're available to whoever has the source.

## Compatibility

- Builds in the field call `/manifest` and `/assets/:key`. Those routes stay and resolve to
  `app_default`, signing with the imported key, permanently.
- Existing CLI setups with `TIDEPUSH_SERVER_URL` and `TIDEPUSH_API_TOKEN` keep working. Tokens
  belong to `org_default` after the backfill, and with only one app the CLI doesn't need an app id.
- The current deployment from `main` is the test environment while phases 1–2 are built. Run
  the migration against a copy of its database first (`wrangler d1 export` then import into a
  scratch database).

## Phases

1. **Tenancy core.** `0003_tenancy.sql` with backfill, app-scoped routes, the legacy route
   mapping, the authorization middleware, and tests for every route proving a token or session
   from org A gets `404` on org B. The old dashboard gets a minimal app switcher so it stays
   usable for testing. Ship in self-host mode only.
2. **Keys per app.** Generation, encryption, caching, BYO upload, export, multiple key ids.
   Import of the legacy secret.
3. **Web app and hosted sign-up.** Scaffold `apps/web` on TanStack Start with the performance
   budgets checked in CI from the first commit. Port Updates, Devices, Audit and Settings, then
   add GitHub OAuth, email sign-up, creating an org on first login, onboarding, the app switcher,
   CLI `login` and `init`, and publish the CLI to npm. Remove `apps/dashboard` once the new app
   reaches parity.
   Also promised by the docs on this branch: password reset by email, invite emails (sent via
   Cloudflare Email Service), an Account → Sessions page that can end sessions, `tidepush logout`
   revoking the CLI credential, and archiving apps.
4. **Metering and billing.** `device_months`, the usage page, Stripe, limits with a grace period,
   and an email to owners when an org goes over a limit.
5. **Launch.** Domains, status page, terms and privacy policy, a data-processing addendum,
   abuse handling, backups (scheduled D1 export to R2), docs site deployed from this branch.
6. **Later, on demand.** Custom update domains per app, SSO/SAML, audit log export, Durable
   Object sharding, bundle diffs.

## Open questions

- Final product domain.
- Should `u.` (phones) and `api.` (CLI) also be separate Workers? Starting with one is simpler;
  split them if admin traffic ever affects update-check latency.
- Do we let free orgs export keys? (Recommended: yes. Avoiding lock-in sells the product.)
- Data residency: R2 location hints per org for EU customers?
