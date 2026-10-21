# Contributing to Tidepush

Thanks for helping! Start with the docs (`bun run website:dev`, then open the Local development guide).

## Development

```sh
bun install
scripts/dev-vars.sh                               # local secrets in apps/server/.dev.vars and apps/web/.dev.vars (gitignored)
bun run --filter @tidepush/server db:migrate:local
bun run dev                                       # API Worker on :8787, web app on :3000
bun run check && bun run typecheck && bun run test   # must pass before a PR
bun run format                                    # fix formatting (Biome)
```

## Pull requests

- Keep each PR to one change and add tests for behaviour changes. Server tests run in the Workers runtime (`apps/server/test`).
- Never commit secrets: private keys, `.dev.vars`, `.env`, API tokens or account IDs. CI and reviewers will reject them.
- Database changes go in a new numbered file in `apps/server/migrations/`. Never edit a migration that has already been released.

## Contributor License Agreement

Tidepush is dual-licensed (AGPL-3.0 and commercial; see `COMMERCIAL-LICENSE.md`). To keep that possible,
contributors must agree that their contribution may be distributed under both licenses. By opening a pull
request you confirm that:

1. you wrote the contribution, or have the right to submit it, and
2. you grant Eugene Koech a perpetual, worldwide, non-exclusive, royalty-free license to use, modify,
   sublicense and distribute your contribution under the AGPL-3.0 and under commercial licenses.

You keep the copyright to your contribution.
