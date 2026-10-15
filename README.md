# Tidepush

**Self-hosted OTA updates for Expo apps, on Cloudflare.**

Tidepush lets you ship JavaScript and asset fixes to your React Native (Expo) app without going
through App Store or Play Store review. It's a self-hosted server for the open
[Expo Updates protocol](https://docs.expo.dev/technical-specs/expo-updates-1/): your app keeps
using the standard `expo-updates` library, and you own the server, the data and the costs.
Those costs are typically $0–5 a month.

```
  your app (expo-updates) ──▶  Tidepush Worker  ──▶  D1 (which update goes to whom)
                                     │           ──▶  R2 (bundles and images, cached at the edge)
  tidepush CLI ─── publish ────────▶│
  dashboard ─── rollouts, rollbacks ─┘
```

- **Stock client:** no custom SDK, just `expo-updates`.
- **Signed updates:** every manifest and rollback is signed, and the app rejects anything else.
- **Staged rollouts:** send an update to 10% of devices, watch it, then widen to 100%.
- **Instant rollback:** to the previous update, or to the bundle that shipped in the store build.
- **Channels:** test on `staging`, then promote the exact same update to `production`.
- **Dashboard:** adoption per update, devices per native build, audit log, admin accounts and API tokens.

## Documentation

The full docs, including concepts, a step-by-step tutorial, guides and reference, are at
**https://tidepush-website.yugenecodes99.workers.dev**. Their source is in [`apps/website`](./apps/website); to read them locally:

```sh
bun install
bun run website:dev        # http://localhost:5173
```

New here? Start with **Introduction → What are OTA updates**, then **Getting started**.

## Quick start (local)

```sh
bun install
scripts/dev-vars.sh                                   # writes apps/server/.dev.vars and prints a setup token
bun run --filter @tidepush/server db:migrate:local
bun run dev                                           # http://localhost:8787 → create the first owner on /setup
```

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/server` | The Cloudflare Worker: update protocol, admin API, auth. D1 migrations and tests. |
| `apps/dashboard` | The admin dashboard (React), served by the Worker. |
| `packages/cli` | The `tidepush` CLI: publish, promote, rollout, rollback, list. |
| `apps/website` | The website and docs (VitePress). |

## Configuration and secrets

No secrets live in this repo. The server reads them from Worker secrets (`wrangler secret put`), or locally from
`apps/server/.dev.vars`; see `.dev.vars.example`. The CLI reads `.env`; see `.env.example`. The docs page
**Reference → Configuration** lists every setting.

## License

Tidepush is licensed under the **GNU AGPL-3.0** ([`LICENSE`](./LICENSE)). You can use it, self-host it and modify it
for free. If you run a modified version as a service for others, you must publish your changes. Commercial licenses
without these obligations are available; see [`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md).

Contributions are welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md); it includes a short contributor
license agreement. To report a security issue, see [`SECURITY.md`](./SECURITY.md).
