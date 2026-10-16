# Local development

Run the whole Tidepush server on your laptop: Worker, D1, R2 and dashboard. Wrangler simulates Cloudflare locally, so you don't need a Cloudflare account for this.

## 1. Install

```sh
git clone https://github.com/Yug3ne/tidepush
cd tidepush
bun install
```

## 2. Create local secrets

Locally, Worker secrets come from `apps/server/.dev.vars` (gitignored). `apps/server/.dev.vars.example` lists every value with fake placeholders.

The helper script writes the file for you:

```sh
scripts/dev-vars.sh
```

```text
Generated a throwaway signing key. A real app needs the key matching its certificate.
Wrote apps/server/.dev.vars
Open http://localhost:8787/setup and use this setup token: setup-3f1c…
```

**What just happened:** with no arguments the script generates a **throwaway signing key** and a random **`SETUP_TOKEN`**, writes both to `apps/server/.dev.vars` (mode `600`), and prints the setup token. Copy it; you need it in step 4.

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

This builds the dashboard and starts `wrangler dev` on `http://localhost:8787`.

- Open `http://localhost:8787`. With an empty database you get `/setup`; use the setup token the script printed (it's also in `.dev.vars`).
- `curl http://localhost:8787/health` → `{"ok":true}`.

::: tip Use localhost for the dashboard
The session cookie (`__Host-tidepush_session`) is marked `Secure`. Browsers accept it on `http://localhost`, but **not** on a plain-HTTP LAN address like `http://192.168.1.20:8787`: login seems to succeed and then you're sent back to `/login`. Open the dashboard via `localhost`. To use it from another device, put it behind HTTPS, e.g. `cloudflared tunnel --url http://localhost:8787`.
:::

### Dashboard with hot reload

```sh
bun run --filter @tidepush/dashboard dev
```

This runs Vite with hot reload and forwards API calls (`/admin`, `/auth`) to the Worker on port 8787, so keep `bun run dev` running too.

### Root scripts

| Command | Does |
| --- | --- |
| `bun run dev` | Build the dashboard, start `wrangler dev` on :8787 |
| `bun run build` | Build the dashboard only |
| `bun run deploy` | Build the dashboard and deploy the Worker |
| `bun run test` | Server tests (in workerd) and CLI tests |
| `bun run typecheck` | Type-check every package |
| `bun run tidepush <cmd>` | Run the CLI |
| `bun run website:dev` / `website:build` | This documentation site |

### The web app (optional)

`apps/web` is the sign-up / sign-in dashboard the hosted service uses (TanStack Start, Better Auth). Run it next to the API Worker:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars     # then set BETTER_AUTH_SECRET
cd apps/server && npx wrangler dev --port 8787        # first: the web app reaches it by service binding
cd apps/web && bun run dev                            # http://localhost:3000
```

Both share the local database (the web app reads the API Worker's `.wrangler/state`). Add `--var TIDEPUSH_MODE:hosted` to the API Worker to try hosted behaviour: sign-ups create organizations, and plan limits apply. `node apps/web/e2e/flow.mjs` runs the whole flow against these two servers in a headless browser.

## 5. Use the CLI against it

Create an API token in the local dashboard (Settings → API tokens), then in the repo root `.env` (copy `.env.example` to start):

```sh
TIDEPUSH_SERVER_URL=http://localhost:8787
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
2. Start Wrangler listening on all interfaces:

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
