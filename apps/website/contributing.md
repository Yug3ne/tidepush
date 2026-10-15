# Contributing

Thanks for helping. The full rules are in [`CONTRIBUTING.md`](https://github.com/Yug3ne/tidepush/blob/main/CONTRIBUTING.md); this page is a short tour.

## Set up

```sh
git clone https://github.com/Yug3ne/tidepush
cd tidepush
bun install
scripts/dev-vars.sh                                  # local secrets (throwaway key + setup token)
bun run --filter @tidepush/server db:migrate:local
bun run dev                                          # http://localhost:8787
```

Details: [Local development](/guides/local-development).

## Before you open a pull request

```sh
bun run test
bun run typecheck
```

CI runs the type check, the tests, the builds and [gitleaks](https://github.com/gitleaks/gitleaks) (secret scanning).

- One change per pull request, with tests for behaviour changes. Server tests live in `apps/server/test` and run inside the Workers runtime.
- Never commit secrets: private keys, `.dev.vars`, `.env`, API tokens or account ids.
- Database changes go in a **new** numbered file in `apps/server/migrations/`. Never edit a released migration.
- Docs changes are welcome. Every docs page has an "Edit this page on GitHub" link.

## Contributor License Agreement

Tidepush is [dual-licensed](/license). By opening a pull request you confirm you wrote the contribution (or have the right to submit it), and you grant the copyright holder a license to distribute it under both the AGPL-3.0 and commercial licenses. You keep the copyright. The exact wording is in `CONTRIBUTING.md`.

## Repository layout

| Path | What |
| --- | --- |
| `apps/server` | Cloudflare Worker (Hono), D1 migrations, tests |
| `apps/dashboard` | React + Vite dashboard, built into the Worker's static assets under `/_app` |
| `packages/cli` | `tidepush` CLI |
| `apps/website` | This website (VitePress) |
| `scripts/dev-vars.sh` | Writes `apps/server/.dev.vars` for local development |

## Working on the website

```sh
bun run website:dev      # http://localhost:5173 with hot reload
bun run website:build    # static build into apps/website/.vitepress/dist
```

- Pages are Markdown files in `apps/website` (`guide/`, `guides/`, `reference/`, …). The sidebar is in `apps/website/.vitepress/config.mts`.
- The landing page is a Vue component: `apps/website/.vitepress/theme/components/Landing.vue`. Colours and fonts are in `.vitepress/theme/custom.css`.
- The build fails on dead links. Fix them before pushing.

## Deploying the website

The website is a static site served by its own small Worker, `tidepush-website`, configured in `apps/website/wrangler.jsonc` (static assets only, no code, no account ids).

```sh
cd apps/website
npx wrangler login        # once
bun run deploy            # vitepress build && wrangler deploy
```

**What happens:** VitePress builds the site into `.vitepress/dist`, then Wrangler uploads those files as the `tidepush-website` Worker's static assets. The first deploy prints a `https://tidepush-website.<your-subdomain>.workers.dev` address. To use your own domain, add a `routes` entry with `custom_domain: true` in `apps/website/wrangler.jsonc` (see the comment in the file) and deploy again.

Serving static assets doesn't count as Worker requests, so hosting the site is free.
