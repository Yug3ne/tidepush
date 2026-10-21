# Tidepush

**OTA updates for Expo apps. Signed, staged, instantly reversible.**

Tidepush lets you ship JavaScript and asset fixes to your React Native (Expo) app without going through App Store
or Play Store review. It's a server for the open [Expo Updates protocol](https://docs.expo.dev/technical-specs/expo-updates-1/):
your app keeps using the standard `expo-updates` library.

- **Stock client:** no custom SDK, just `expo-updates`.
- **Signed updates:** every manifest and rollback is signed with the app's own key, and the app rejects anything else.
- **Staged rollouts:** send an update to 10% of devices, watch it, then widen to 100%.
- **Instant rollback:** to the previous update, or to the bundle that shipped in the store build.
- **Channels:** test on `staging`, then promote the exact same update to `production`.
- **Teams and apps:** organizations, owner / admin / read-only roles, any number of apps, API tokens for CI.

## Two ways to use it

### Hosted: sign up and ship

1. Create an account at **https://tidepush-web.yugenecodes99.workers.dev/signup** (free plan, no card).
2. Name your organization and add your app. Its update URL and signing key are created for you.
3. In your Expo app:

   ```sh
   npx tidepush login                       # approve the CLI in your browser
   npx tidepush init                        # writes updates.url and the certificate into your app
   # make a release build, then publish after it:
   npx tidepush publish --channel production -m "Fix the fee copy"
   ```

The full walkthrough is **Getting started** in the [docs](https://tidepush-website.yugenecodes99.workers.dev/guide/getting-started).

### Self-hosted: run it on your Cloudflare account

Two Workers (the API and the web app), one D1 database and one R2 bucket on your own account, usually $0–5 a
month, with no plan limits.
Follow **[docs/self-hosting](./docs/self-hosting/README.md)**: [deploy.md](./docs/self-hosting/deploy.md) takes
you from nothing to an update on a phone. Already running Tidepush? Read
[upgrading.md](./docs/self-hosting/upgrading.md) first.

## How it fits together

```
  phones (expo-updates) ─────────────────▶ API Worker (apps/server) ──▶ R2 (bundles, cached at the edge)
  CLI / CI with a tp_ API token ─────────▶        ▲                   ──▶ D1 (updates, devices, accounts)
                                                  │ service binding
  browser ───────────────────────────────▶ web app (apps/web)        ──▶ same D1 (people, sessions)
  CLI after `tidepush login` ── /api/v1 ─▶ (sign-in, dashboard)
```

Phones and CI talk to the API Worker. People use the web app, which signs them in and calls the API Worker
over a service binding. Hosted and self-hosted deployments run the same two Workers.

## Developing Tidepush

```sh
bun install
scripts/dev-vars.sh                                   # writes both apps' .dev.vars and prints a setup token
bun run --filter @tidepush/server db:migrate:local
bun run dev                                           # API on :8787, web app on http://localhost:3000/setup
```

Hosted mode, tests and the end-to-end check are in [local-development.md](./docs/self-hosting/local-development.md).
Before a pull request: `bun run check && bun run typecheck && bun run test`.

| Path | What it is |
| --- | --- |
| `apps/server` | The API Worker: update protocol, admin API, tenancy, billing. D1 migrations and tests. |
| `apps/web` | The web app (TanStack Start, Better Auth): sign-in, invites, the dashboard. Hosted and self-hosted. |
| `packages/cli` | The `tidepush` CLI: login, init, publish, promote, rollout, rollback, list. |
| `packages/api` | The admin API's JSON types, shared by the server, the web app and the CLI. |
| `packages/tsconfig` | The TypeScript settings every package extends. |
| `apps/website` | The docs site (VitePress). |
| `docs/self-hosting` | The self-hosting guide. |

No secrets live in this repo. Workers read them from Worker secrets (`wrangler secret put`), or locally from
`.dev.vars` (see each app's `.dev.vars.example`). The CLI reads `.env` (see `.env.example`).
[configuration.md](./docs/self-hosting/configuration.md) lists every setting.

## License

Tidepush is licensed under the **GNU AGPL-3.0** ([`LICENSE`](./LICENSE)). You can use it, self-host it and modify it
for free. If you run a modified version as a service for others, you must publish your changes. Commercial licenses
without these obligations are available; see [`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md).

Contributions are welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md); it includes a short contributor
license agreement. To report a security issue, see [`SECURITY.md`](./SECURITY.md).
