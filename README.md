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

One Worker, one D1 database and one R2 bucket on your own account, usually $0–5 a month, with no plan limits.
Follow **[docs/self-hosting](./docs/self-hosting/README.md)**: [deploy.md](./docs/self-hosting/deploy.md) takes
you from nothing to an update on a phone. Already running Tidepush? Read
[upgrading.md](./docs/self-hosting/upgrading.md) first.

## How it fits together

```
  phones (expo-updates) ──▶ API Worker (apps/server) ──▶ D1 (updates, devices, accounts)
  tidepush CLI ──────────▶        │  built-in dashboard  ──▶ R2 (bundles, cached at the edge)
  browser ──▶ web app (apps/web) ─┘  over a service binding (hosted sign-up and dashboard)
```

## Developing Tidepush

```sh
bun install
scripts/dev-vars.sh                                   # writes apps/server/.dev.vars and prints a setup token
bun run --filter @tidepush/server db:migrate:local
bun run dev                                           # http://localhost:8787: create the first owner on /setup
```

The web app, tests and the end-to-end check are in [local-development.md](./docs/self-hosting/local-development.md).
Before a pull request: `bun run typecheck && bun run test`.

| Path | What it is |
| --- | --- |
| `apps/server` | The API Worker: update protocol, admin API, auth, tenancy, billing. D1 migrations and tests. |
| `apps/dashboard` | The built-in dashboard (React), served by the API Worker. Used by self-hosted servers. |
| `apps/web` | The web app (TanStack Start, Better Auth): sign-up, sign-in, dashboard. Used by the hosted service. |
| `packages/cli` | The `tidepush` CLI: login, init, publish, promote, rollout, rollback, list. |
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
