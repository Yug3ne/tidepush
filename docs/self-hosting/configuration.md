# Configuration reference

Every setting in one place. There are four places configuration lives:

| Where | Used by | Secret? |
| --- | --- | --- |
| `apps/server/wrangler.jsonc` → `vars` | The Worker | No (committed) |
| Worker secrets (`wrangler secret put`), or `apps/server/.dev.vars` locally | The Worker | Yes |
| `.env` in the Tidepush repo root | The CLI | Yes (gitignored) |
| Your app's `app.json` / `app.config.ts` | The phone | No |

## Worker vars (`wrangler.jsonc`)

| Name | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CODE_SIGNING_KEY_ID` | Yes | `"main"` | Sent as `keyid` in signatures. Must equal `updates.codeSigningMetadata.keyid` in the app. |
| `ACCESS_TEAM_DOMAIN` | No | `""` | Cloudflare Access team domain, e.g. `yourteam.cloudflareaccess.com`. Empty turns Access off. |
| `ACCESS_AUD` | No | `""` | Access application AUD tag. Empty turns Access off. Both must be set for Access to be used. |

Change them in `wrangler.jsonc`, then `bun run deploy`.

## Worker secrets

Set with Wrangler from `apps/server`:

```sh
npx wrangler secret put <NAME>
npx wrangler secret list
npx wrangler secret delete <NAME>
```

| Name | Required | Meaning | Example / how to create |
| --- | --- | --- | --- |
| `CODE_SIGNING_PRIVATE_KEY` | **Yes** | RSA private key, PEM. PKCS#1 (`BEGIN RSA PRIVATE KEY`, what Expo generates) or PKCS#8 (`BEGIN PRIVATE KEY`). | `npx wrangler secret put CODE_SIGNING_PRIVATE_KEY < private-key.pem` |
| `SETUP_TOKEN` | For first-run setup | Unlocks `/setup` to create the first owner. Ignored once an owner exists. | `openssl rand -hex 32` |
| `ADMIN_API_TOKENS` | No | Break-glass bearer tokens, comma-separated. Entries shorter than 32 characters are ignored. | `openssl rand -hex 32` |

Locally the same names go in `apps/server/.dev.vars` (see `apps/server/.dev.vars.example`, or generate it with `scripts/dev-vars.sh`):

```sh
CODE_SIGNING_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
SETUP_TOKEN="setup-…"
```

## Bindings (`wrangler.jsonc`)

| Binding | Type | Name | Notes |
| --- | --- | --- | --- |
| `DB` | D1 | `tidepush` | Created automatically by name on the first deploy. Migrations in `apps/server/migrations`. |
| `BUCKET` | R2 | `tidepush-assets` | Create it first: `npx wrangler r2 bucket create tidepush-assets`. |
| `ASSETS` | Static assets | `../dashboard/dist` | The built dashboard. `run_worker_first: ["/*", "!/_app/*"]`: the Worker handles every path except the dashboard's hashed files under `/_app`, so the API routes work and the dashboard HTML gets security headers. Unknown non-API paths fall back to the dashboard (single-page app). |

`wrangler.jsonc` in the repository intentionally contains **no** account id, database id or domain. Add your own `routes` for a [custom domain](/guides/custom-domain).

Other settings in the file: `workers_dev: true` (serve on workers.dev), `preview_urls: false`, `observability.enabled: true` (logs in the Cloudflare dashboard).

## CLI (`.env`)

| Name | Required | Meaning |
| --- | --- | --- |
| `TIDEPUSH_SERVER_URL` | Yes | Server base URL, e.g. `https://ota.example.com`. |
| `TIDEPUSH_API_TOKEN` | Yes | `tp_…` API token. |
| `TIDEPUSH_APP_DIR` | For publish | Path to the Expo app. |
| `TIDEPUSH_ACCESS_CLIENT_ID` | Only behind Access | Access service token id. |
| `TIDEPUSH_ACCESS_CLIENT_SECRET` | Only behind Access | Access service token secret. |

See the [CLI reference](/reference/cli).

## App config (`app.json` / `app.config.ts`)

| Key | Value | Notes |
| --- | --- | --- |
| `runtimeVersion` | `{ "policy": "fingerprint" }` | Recommended. |
| `updates.url` | `https://<server>/manifest` | Built into the app. Changing it needs a new build. |
| `updates.enabled` | `true` | |
| `updates.checkAutomatically` | `"ON_LOAD"` | Check on every cold start. |
| `updates.fallbackToCacheTimeout` | `0` | Don't block startup on the network. |
| `updates.requestHeaders["expo-channel-name"]` | e.g. `"production"` | The build's channel. Set per build with `TIDEPUSH_CHANNEL` in `app.config.ts`. |
| `updates.codeSigningCertificate` | `"./certs/certificate.pem"` | Your certificate. |
| `updates.codeSigningMetadata` | `{ "keyid": "main", "alg": "rsa-v1_5-sha256" }` | `keyid` must equal `CODE_SIGNING_KEY_ID`. |

Plus, optionally, `fingerprint.config.js` to keep the channel header out of the runtime fingerprint. See [Channels & promoting](/guides/channels).

## Server limits built into the code

| Limit | Value |
| --- | --- |
| Max size of one uploaded file | 95 MB |
| Asset keys per publish / missing-check request | 5000 |
| Channel name | `^[a-z0-9][a-z0-9._-]{0,63}$` (case-insensitive) |
| Update message | 1000 characters |
| `list` limit | 500 |
| Updates considered per manifest request | newest 200 in the line |
| Password length | 12–256 |
| Session lifetime | 7 days absolute, 24 hours idle |
| Invite lifetime | 72 hours |
| Login rate limit | 5 failures per email or 20 per IP in 15 minutes |
