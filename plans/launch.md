# Launch runbook: the hosted service

Internal. Everything here is a deploy or an account action; nothing is done yet.

## 1. Domains

Pick the product domain (placeholder everywhere: `tidepush.dev`). Then:

| Hostname | Worker | Serves |
| --- | --- | --- |
| `u.<domain>` | `tidepush` (apps/server) | Phones: `/<appId>/manifest`, `/<appId>/assets/:key` |
| `api.<domain>` | `tidepush` | CLI and CI with API tokens: `/admin/*` |
| `app.<domain>` | `tidepush-web` (apps/web) | Sign-up, sign-in, dashboard, `tidepush login` |
| `<domain>` | `tidepush-website` | Docs |

Replace `tidepush.dev` in one pass: docs site, CLI defaults (`packages/cli/src/api.ts`), `apps/web/src/lib/config.ts`.

## 2. API Worker (apps/server)

```sh
cd apps/server
npx wrangler login
npx wrangler r2 bucket create tidepush-assets        # if new
npx wrangler d1 migrations apply tidepush --remote   # 0003-0006 on an existing database
npx wrangler secret put KEY_ENCRYPTION_KEY           # openssl rand -base64 32. Never change it later.
npx wrangler secret put CODE_SIGNING_PRIVATE_KEY     # existing deployments: already set
```

`wrangler.jsonc` vars for hosted: `TIDEPUSH_MODE=hosted`, `WEB_URL=https://app.<domain>`,
`EMAIL_FROM="Tidepush <no-reply@<domain>>"`. Add `routes` for `u.` and `api.` with `custom_domain: true`.

Before migrating the live database: `npx wrangler d1 export tidepush --remote --output backup.sql`. D1 Time
Travel also allows restoring to any minute in the last 30 days (`wrangler d1 time-travel`).

## 3. Web Worker (apps/web)

```sh
cd apps/web
npx wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32
npx wrangler secret put GITHUB_CLIENT_ID       # GitHub OAuth app, callback https://app.<domain>/api/auth/callback/github
npx wrangler secret put GITHUB_CLIENT_SECRET
bun run deploy
```

Vars: `BETTER_AUTH_URL=https://app.<domain>`, `UPDATES_URL=https://u.<domain>`, `EMAIL_FROM` as above.
Deploy the API Worker first: the web app's service binding needs its `Internal` entrypoint.

## 4. Email

```sh
npx wrangler email sending enable <domain>
```

Then set up SPF/DKIM/DMARC as shown. Test an invite and a password reset to a real inbox.

## 5. CLI

```sh
cd packages/cli && npm login && npm publish
```

`prepublishOnly` builds and runs the tests.

## 6. Subscriptions (until payments)

`scripts/set-subscription.sh <orgId> on` (remote by default). The org id is on its Settings → Billing page.

## 7. Check

`apps/web/e2e/flow.mjs` with `WEB_URL=https://app.<domain>` runs the whole flow against production
(sign-up through publish and a signed manifest). It needs the e2e's local reset-password log step skipped
or a real inbox.

## Not code (yours)

- Terms of service, privacy policy, data-processing addendum.
- A status page.
- Abuse contact and process (someone ships malware through an app).
- Decide the paid prices (docs avoid numbers).
