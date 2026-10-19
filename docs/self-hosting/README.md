# Self-hosting Tidepush

Run Tidepush on your own Cloudflare account: your keys, your data, your bill (usually $0–5 a month).
The hosted service runs this same code; this folder is the guide for running it yourself. The
[docs site](https://tidepush-website.yugenecodes99.workers.dev) covers using Tidepush (channels,
rollouts, rollbacks, CI); [deploy.md](./deploy.md#using-the-guides-on-the-docs-site) explains how
its steps map onto your own server.

## What you run

| Piece | Required | What it is |
| --- | --- | --- |
| **API Worker** `tidepush` (`apps/server`) | Yes | Serves phones (`/manifest`, `/<appId>/manifest`, files) and the admin API for the CLI and CI. No web pages. |
| **Web app** `tidepush-web` (`apps/web`) | Yes | The dashboard: sign-in, invites, updates, devices, team and settings (TanStack Start, Better Auth). Reaches the API Worker over a service binding. |
| **D1 database** `tidepush` | Yes | Updates, devices, accounts, audit log. Shared by both Workers. Created on first deploy. |
| **R2 bucket** `tidepush-assets` | Yes | Bundles and images. Only the API Worker uses it. |

The hosted service runs the same two Workers. A self-hosted server has **one organization** (created at
first-run setup), any number of **apps** (one per Expo app), no public sign-up (people join by invite),
and **no plan limits**.

## Start here

1. **New server:** follow [deploy.md](./deploy.md), about an hour from nothing to an update on a phone.
2. **Already running Tidepush?** Read [upgrading.md](./upgrading.md#upgrading-to-the-web-app-dashboard-migration-0007)
   before deploying this version: the built-in dashboard is gone, and you deploy the web app next to the
   API Worker. Your builds, tokens and accounts keep working.
3. **Working on Tidepush itself:** [local-development.md](./local-development.md).

## All pages

| Page | What it covers |
| --- | --- |
| [deploy.md](./deploy.md) | Zero to a first update on your own Cloudflare account (both Workers); more apps; using the docs site's guides |
| [configuration.md](./configuration.md) | Every var, secret and binding of both Workers, and the CLI's settings |
| [code-signing.md](./code-signing.md) | Keys: the first app's secret, per-app keys, rotation |
| [admin-accounts.md](./admin-accounts.md) | First-run setup, roles, invites, sign-in, tokens, Cloudflare Access, recovering access |
| [custom-domain.md](./custom-domain.md) | Serving updates from your own domain (do this before your first store release) |
| [upgrading.md](./upgrading.md) | Upgrading and running migrations, including this version's |
| [local-development.md](./local-development.md) | Running the API Worker and the web app locally |
| [moving-accounts.md](./moving-accounts.md) | Moving to another Cloudflare account |
| [admin-api.md](./admin-api.md) | The admin HTTP API |
| [database.md](./database.md) | The D1 schema |
| [security.md](./security.md) | Security model of a self-hosted deployment |
| [costs.md](./costs.md) | Cloudflare costs and limits |
| [troubleshooting.md](./troubleshooting.md) | Troubleshooting, including deployment problems |

The quick local start is also in the repository [README](../../README.md).
