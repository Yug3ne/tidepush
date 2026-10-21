# Local development

Run the whole of Tidepush on your laptop: the API Worker, the web app (the dashboard), D1 and R2. Wrangler simulates Cloudflare locally, so you don't need a Cloudflare account for this.

## 1. Install

```sh
git clone https://github.com/Yug3ne/tidepush
cd tidepush
bun install
```

## 2. Create local secrets

Locally, Worker secrets come from `.dev.vars` files (gitignored): `apps/server/.dev.vars` for the API Worker and `apps/web/.dev.vars` for the web app. Each app's `.dev.vars.example` lists every value with fake placeholders.

The helper script writes both for you:

```sh
scripts/dev-vars.sh
```

```text
Generated a throwaway signing key. A real app needs the key matching its certificate.
Wrote apps/server/.dev.vars
Wrote apps/web/.dev.vars
Run `bun run dev`, open http://localhost:3000/setup and use this setup token: setup-3f1c…
```

**What just happened:** with no arguments the script generates a **throwaway signing key** and a random **`SETUP_TOKEN`** and writes them to `apps/server/.dev.vars` (mode `600`). It also writes `apps/web/.dev.vars` with a random `BETTER_AUTH_SECRET`; if that file already has one, it's kept (with any GitHub settings), and the `Wrote apps/web/.dev.vars` line doesn't appear. It prints the setup token; copy it, you need it in step 4.

To test with a real app build, pass the private key whose certificate is in that app:

```sh
scripts/dev-vars.sh .secrets/codesigning-keys/private-key.pem
```

Apps refuse updates signed with a key that doesn't match their certificate. That's expected with the throwaway key; it's also how you do the [tamper check](https://tidepush-website.yugenecodes99.workers.dev/guides/testing-on-device#tamper-check).

::: warning Never commit .dev.vars
It contains your private key. It's in `.gitignore`; keep it that way.
:::

## 3. Create the local database

```sh
bun run --filter @tidepush/server db:migrate:local
```

This applies every migration to a local SQLite file under `apps/server/.wrangler/state`.

## 4. Start

```sh
bun run dev
```

This starts both servers:

| Server | Address |
| --- | --- |
| API Worker (`wrangler dev`) | `http://localhost:8787` |
| Web app (`vite dev`, with hot reload) | `http://localhost:3000` |

They share the local database under `apps/server/.wrangler/state`, and the web app reaches the API Worker through its service binding, as in production.

- Open `http://localhost:3000`. With an empty database you get `/setup`; use the setup token the script printed (it's also in `apps/server/.dev.vars`).
- `curl http://localhost:8787/health` → `{"ok":true}`.

::: tip Use localhost for the web app
Sign-in works on `http://localhost:3000`, the web app's `BETTER_AUTH_URL` locally. Open the dashboard there rather than on a LAN address like `http://192.168.1.20:3000`. To use it from another device, put it behind HTTPS, e.g. `cloudflared tunnel --url http://localhost:3000`, and set `BETTER_AUTH_URL` to the tunnel's address in `apps/web/.dev.vars`.
:::

::: warning Only one API Worker named `tidepush` at a time
The web app finds the API Worker through Wrangler's local dev registry, by name. If another `wrangler dev` for `apps/server` is already running (for example in another terminal or another checkout), the web app may talk to that one instead, with its settings. Stop the other one first.
:::

### Root scripts

| Command | Does |
| --- | --- |
| `bun run dev` | Start the API Worker on :8787 and the web app on :3000 |
| `bun run build` | Build the web app, this documentation site and the CLI |
| `bun run deploy` | Deploy the API Worker, then the web app |
| `bun run test` | Server tests (in workerd) and CLI tests |
| `bun run typecheck` | Type-check every package |
| `bun run tidepush <cmd>` | Run the CLI |
| `bun run website:dev` / `website:build` | This documentation site |

The scripts run through [Turborepo](https://turborepo.com). It caches `build`, `typecheck` and `test` per package (in `.turbo/`), so a rerun with no changes finishes right away. To run a task in one package, use `bunx turbo run <task> --filter=<package>`, for example `bunx turbo run test --filter=@tidepush/server`.

### Trying hosted behaviour

The hosted service runs with `TIDEPUSH_MODE` = `hosted`: sign-ups create organizations, and plan limits apply. To try it, start the two servers yourself instead of `bun run dev`:

```sh
cd apps/server && npx wrangler dev --port 8787 --var TIDEPUSH_MODE:hosted
cd apps/web && bun run dev                            # in a second terminal: http://localhost:3000
```

`node apps/web/e2e/flow.mjs` runs the hosted end-to-end flow against these two servers in a headless browser.

### End-to-end check of a self-hosted server

`apps/web/e2e/selfhost.mjs` walks a brand-new self-hosted server through first-run setup, closed sign-up, an invite and the invitee's first sign-in. It needs an **empty** local database, so move `apps/server/.wrangler/state` aside first (and back afterwards), then:

```sh
bun run --filter @tidepush/server db:migrate:local
bun run dev                                           # in a second terminal
SETUP_TOKEN="$(sed -n 's/^SETUP_TOKEN="\(.*\)"$/\1/p' apps/server/.dev.vars)" node apps/web/e2e/selfhost.mjs
```

## 5. Use the CLI against it

Create an API token in the local web app (http://localhost:3000, **Settings → API tokens**), then in the repo root `.env` (copy `.env.example` to start):

```sh
TIDEPUSH_SERVER_URL=http://localhost:8787      # the API Worker, not the web app
TIDEPUSH_TOKEN=tp_…
TIDEPUSH_APP_DIR=/absolute/path/to/your-app
```

```sh
bun run tidepush list
```

Keep a separate `.env` for production, or pass `--server` to switch:

```sh
bun run tidepush list --server http://localhost:8787
```

## 6. Tests and type checks

```sh
bun run test        # server tests run inside workerd (the real Workers runtime)
bun run typecheck   # all packages
```

## Testing with a real phone on your network

Phones can't reach `localhost` on your laptop. Use your laptop's LAN IP:

1. Find it: `ip addr` (Linux) or `ipconfig getifaddr en0` (macOS). Say it's `192.168.1.20`.
2. Start the API Worker listening on all interfaces, instead of `bun run dev` (only one may run). If you need the dashboard too, start it in a second terminal with `cd apps/web && bun run dev`.

   ```sh
   cd apps/server
   npx wrangler dev --ip 0.0.0.0
   ```

3. In your app, temporarily set `updates.url` to `http://192.168.1.20:8787/manifest` and make a **release** build.
4. Publish with `TIDEPUSH_SERVER_URL=http://localhost:8787` (the CLI runs on your laptop, so localhost is fine).

::: warning Plain HTTP on Android
Android release builds block plain `http://` traffic by default. For a LAN test either use a tunnel with HTTPS (`cloudflared tunnel --url http://localhost:8787` gives you a temporary `https://….trycloudflare.com` address), or allow cleartext traffic in the test build only. Don't ship a store build with cleartext allowed or with a LAN URL.
:::

Asset URLs in the manifest are built from the address the phone used, so they automatically point to your LAN IP or tunnel.

The full device test is in [Testing on a device](https://tidepush-website.yugenecodes99.workers.dev/guides/testing-on-device).
