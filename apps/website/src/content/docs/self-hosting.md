---
title: "Self-hosting"
---

Tidepush is open source under the **AGPL-3.0**. The hosted service at [tidepush-web.yugenecodes99.workers.dev](https://tidepush-web.yugenecodes99.workers.dev) runs the same code.

Most teams are best served by the hosted service: there's nothing to deploy, patch, monitor or back up. Some teams have to run it themselves, for example regulated apps that must keep signing keys and release data on their own infrastructure. They can.

## Where to start

This site documents the hosted service. Self-hosting instructions ship with the source code, in the [GitHub repository](https://github.com/Yug3ne/tidepush).

A self-hosted Tidepush works with the same `expo-updates` setup, the same CLI and the same dashboard. Your apps use your own server's address in `updates.url` instead of `tidepush.yugenecodes99.workers.dev`.

## What you run

The same two Workers as the hosted service, on your own Cloudflare account:

| Worker | What it does |
| --- | --- |
| **API** (`apps/server`) | Serves phones (manifests and files) and the admin API for the CLI and CI |
| **Web app** (`apps/web`) | The dashboard: sign-in, invites, updates, team and settings. It reaches the API over a service binding. |

Both use one D1 database; bundles go in an R2 bucket. You deploy the API first, then the web app, then create the first owner at the web app's `/setup` page with a setup token. A self-hosted server has no public sign-up: everyone else joins by invite. On your machine, sign the CLI in with `npx tidepush login --web <your web app URL>`; in CI, set `TIDEPUSH_SERVER_URL` to your API's address next to `TIDEPUSH_TOKEN`.

The step-by-step guide is `docs/self-hosting/deploy.md` in the repository.

## Moving between hosted and self-hosted

`updates.url` and the certificate are built into each binary. Builds already on phones keep asking the address they were built with. So moving in either direction means:

1. **Keep the same key.** An owner exports the app's private key from **Settings → Code signing** (hosted), or uploads your existing key when creating the app (hosted). The certificate in your app then stays valid.
2. **Ship a new store build** that points `updates.url` at the new address.
3. **Publish to both places** until most users have the new build. The dashboard's Devices page shows how many devices are on each.

## Licensing

Running Tidepush yourself, unmodified, for your own apps has no conditions beyond the AGPL's notices. If you modify it and let others use it over a network, or offer it as a service, the AGPL requires you to share your changes. Commercial licenses without these conditions are available. See [License](/license).
