# Configuration reference

Every setting in one place. A self-hosted Tidepush is two Workers: the **API Worker** (`apps/server`, named `tidepush`) and the **web app** (`apps/web`, named `tidepush-web`, the dashboard). Configuration lives in these places:

| Where | Used by | Secret? |
| --- | --- | --- |
| `apps/server/wrangler.jsonc` → `vars` | The API Worker | No (committed) |
| API Worker secrets (`wrangler secret put` in `apps/server`), or `apps/server/.dev.vars` locally | The API Worker | Yes |
| `apps/web/wrangler.jsonc` → `vars` | The web app | No (committed) |
| Web app secrets (`wrangler secret put` in `apps/web`), or `apps/web/.dev.vars` locally | The web app | Yes |
| `.env` in the Tidepush repo root | The CLI | Yes (gitignored) |
| Your app's `app.json` / `app.config.ts` | The phone | No |

## API Worker vars

In `apps/server/wrangler.jsonc`:

| Name | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CODE_SIGNING_KEY_ID` | Yes | `"main"` | Sent as `keyid` in signatures. Must equal `updates.codeSigningMetadata.keyid` in the app. |
| `WEB_URL` | Set it | `""` | The web app's public URL, e.g. `https://tidepush-web.<your-subdomain>.workers.dev`. Used for invite links and emails, plan-warning emails, and the redirect from this Worker's `/`. Empty: `/` answers `404`, and invites created in the web app still link to the web app's own URL. |
| `TIDEPUSH_MODE` | No | `"selfhost"` | Leave as `selfhost`: no plan limits, one organization, no public sign-up. (`hosted` is for the Tidepush service.) |
| `EMAIL_FROM` | No | `""` | Sender for invite emails, e.g. `Tidepush <ota@yourcompany.com>`, on a domain onboarded with `wrangler email sending enable`. Empty: no email; invite links are shown to copy. |

Change them in `wrangler.jsonc`, then `bun run deploy`.

## API Worker secrets

Set with Wrangler from `apps/server`:

```sh
npx wrangler secret put <NAME>
npx wrangler secret list
npx wrangler secret delete <NAME>
```

| Name | Required | Meaning | Example / how to create |
| --- | --- | --- | --- |
| `CODE_SIGNING_PRIVATE_KEY` | **Yes** | RSA private key, PEM. PKCS#1 (`BEGIN RSA PRIVATE KEY`, what Expo generates) or PKCS#8 (`BEGIN PRIVATE KEY`). | `npx wrangler secret put CODE_SIGNING_PRIVATE_KEY < private-key.pem` |
| `SETUP_TOKEN` | For first-run setup | Unlocks the web app's `/setup` page to create the first owner. Ignored once an owner exists. | `openssl rand -hex 32` |
| `ADMIN_API_TOKENS` | No | Break-glass bearer tokens, comma-separated. Entries shorter than 32 characters are ignored. | `openssl rand -hex 32` |
| `KEY_ENCRYPTION_KEY` | Recommended | 32 random bytes, base64. Encrypts each app's own signing key. Without it, only the first app can sign (with `CODE_SIGNING_PRIVATE_KEY`). **Never change it once apps have keys**: their keys can't be decrypted with a different one. | `openssl rand -base64 32` |

Locally the same names go in `apps/server/.dev.vars` (see `apps/server/.dev.vars.example`, or generate it with `scripts/dev-vars.sh`):

```sh
CODE_SIGNING_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
SETUP_TOKEN="setup-…"
```

## API Worker bindings

| Binding | Type | Name | Notes |
| --- | --- | --- | --- |
| `DB` | D1 | `tidepush` | Created automatically by name on the first deploy. Migrations in `apps/server/migrations`. |
| `BUCKET` | R2 | `tidepush-assets` | Create it first: `npx wrangler r2 bucket create tidepush-assets`. Only the API Worker binds it. |
| `EMAIL` | Send email | | Invite and plan emails, used when `EMAIL_FROM` is set. |

`wrangler.jsonc` in the repository intentionally contains **no** account id, database id or domain. Add your own `routes` for a [custom domain](./custom-domain.md).

Other settings in the file: `workers_dev: true` (serve on workers.dev), `preview_urls: false`, `observability.enabled: true` (logs in the Cloudflare dashboard).

## Web app vars

In `apps/web/wrangler.jsonc`:

| Name | Required | Default | Meaning |
| --- | --- | --- | --- |
| `BETTER_AUTH_URL` | Yes | `"http://localhost:3000"` | The web app's public URL, e.g. `https://tidepush-web.<your-subdomain>.workers.dev` or your custom domain. Sign-in callbacks and links are built from it. |
| `UPDATES_URL` | Yes | `"http://localhost:8787"` | The API Worker's URL, the one phones use. Shown in the dashboard as the start of each app's `updates.url`, and used by `tidepush init`. |
| `EMAIL_FROM` | No | `""` | Sender for password-reset emails, on a domain onboarded with `wrangler email sending enable`. Empty: no email; the reset link is only written to the web app's logs. |

Change them in `wrangler.jsonc`, then `bun run deploy`.

## Web app secrets

Set with Wrangler from `apps/web`:

```sh
cd apps/web
npx wrangler secret put <NAME>
```

| Name | Required | Meaning | Example / how to create |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | **Yes** | Signs sign-in cookies. Changing it signs everyone out. | `openssl rand -base64 32` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | No | Turn on "Continue with GitHub". Create an OAuth app at [github.com/settings/developers](https://github.com/settings/developers) with the callback URL `<web URL>/api/auth/callback/github`. On a self-hosted server, GitHub only signs in people who already have an account with the same verified email; it never creates accounts. | |

Locally they go in `apps/web/.dev.vars` (see `apps/web/.dev.vars.example`; `scripts/dev-vars.sh` writes it with a random `BETTER_AUTH_SECRET`).

## Web app bindings

| Binding | Type | Name | Notes |
| --- | --- | --- | --- |
| `DB` | D1 | `tidepush` | The same database as the API Worker. People, passwords and sessions live here. |
| `API` | Service | `tidepush`, entrypoint `Internal` | Everything else goes to the API Worker through this binding, as the signed-in person. Not reachable from the internet. Deploy the API Worker before the web app's first deploy. |
| `EMAIL` | Send email | | Password-reset emails, used when `EMAIL_FROM` is set. |

## CLI (`.env`)

| Name | Required | Meaning |
| --- | --- | --- |
| `TIDEPUSH_SERVER_URL` | With a token | The API Worker's URL, e.g. `https://ota.example.com`. Without it, the CLI talks to the hosted service. |
| `TIDEPUSH_TOKEN` | In CI | `tp_…` API token from the dashboard's **Settings → API tokens** (`TIDEPUSH_API_TOKEN` also works). When set, it's used instead of a saved login. |
| `TIDEPUSH_WEB_URL` | For `login` | The web app's URL, for `tidepush login` on your machine. Same as `login --web <url>`. After login the CLI talks to the web app, so `TIDEPUSH_SERVER_URL` isn't needed. |
| `TIDEPUSH_APP_ID` | With several apps | The app to act on, if `updates.url` in the app config doesn't name one. Same as `--app`. |
| `TIDEPUSH_APP_DIR` | For publish | Path to the Expo app. |
| `TIDEPUSH_ACCESS_CLIENT_ID` | Only behind Access | Access service token id, if you put [Cloudflare Access](./admin-accounts.md#optional-cloudflare-access) in front of `/admin` on the API hostname. |
| `TIDEPUSH_ACCESS_CLIENT_SECRET` | Only behind Access | Access service token secret. |

See the [CLI reference](https://tidepush-website.yugenecodes99.workers.dev/reference/cli).

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

Plus, optionally, `fingerprint.config.js` to keep the channel header out of the runtime fingerprint. See [Channels & promoting](https://tidepush-website.yugenecodes99.workers.dev/guides/channels).

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
| Session lifetime | 7 days without use (renewed at most once a day while you use it) |
| Invite lifetime | 72 hours |
| Sign-in and sign-up rate limit | 10 attempts per minute per IP |
