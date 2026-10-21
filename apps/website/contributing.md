# Contributing

Thanks for helping. Tidepush is open source, and the hosted service runs the same code you contribute to.

## Set up

Clone the [repository](https://github.com/Yug3ne/tidepush) and follow `CONTRIBUTING.md`. It covers installing dependencies and running everything locally.

## Before you open a pull request

```sh
bun run check       # lint and formatting (Biome); `bun run format` fixes formatting
bun run typecheck
bun run test
```

CI runs the linter, the type check, the tests, the builds, a check that the generated Worker types are current and [gitleaks](https://github.com/gitleaks/gitleaks) (secret scanning).

- One change per pull request, with tests for behaviour changes.
- Never commit secrets: private keys, API tokens or account ids.
- Database changes go in a **new** numbered migration file. Never edit a released migration.

## Contributor License Agreement

Tidepush is [dual-licensed](/license). By opening a pull request you confirm you wrote the contribution (or have the right to submit it), and you grant the copyright holder a license to distribute it under both the AGPL-3.0 and commercial licenses. You keep the copyright. The exact wording is in `CONTRIBUTING.md`.

## Improving these docs

Docs changes are welcome. Every page has an "Edit this page on GitHub" link.

- Pages are Markdown files in `apps/website`.
- Preview with `bun run website:dev`.
- The build fails on dead links. Fix them before pushing.
