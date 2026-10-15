# CI/CD with GitHub Actions

This guide publishes an update to the **staging** channel every time you push to `main` in your **app** repository.

## How it fits together

The CLI lives in the Tidepush repository, and your app lives in its own repository. The workflow checks out both:

```text
GitHub Actions runner
├── app/          ← your Expo app (this repository)
└── tidepush/    ← Tidepush, for the CLI
        bun run tidepush publish --app-dir ../app --channel staging
```

## 1. Create an API token for CI

Dashboard → **Settings → API tokens** → create one named `github-actions`. Copy the `tp_…` value.

## 2. Add repository secrets

In your app repository on GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value |
| --- | --- |
| `TIDEPUSH_SERVER_URL` | `https://ota.example.com` (or your workers.dev URL) |
| `TIDEPUSH_API_TOKEN` | The `tp_…` token |

If your admin API is behind Cloudflare Access, also add `TIDEPUSH_ACCESS_CLIENT_ID` and `TIDEPUSH_ACCESS_CLIENT_SECRET`.

## 3. Add the workflow

Create `.github/workflows/ota-staging.yml` in your app repository:

```yaml
name: OTA → staging

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ota-staging
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Check out the app
        uses: actions/checkout@v4
        with:
          path: app

      - name: Check out Tidepush
        uses: actions/checkout@v4
        with:
          repository: Yug3ne/tidepush
          # Pin a tag or commit you have tested, rather than following main.
          ref: main
          path: tidepush

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: oven-sh/setup-bun@v2

      - name: Install app dependencies
        working-directory: app
        run: npm ci   # or: bun install --frozen-lockfile / yarn install --frozen-lockfile

      - name: Install Tidepush
        working-directory: tidepush
        run: bun install --frozen-lockfile

      - name: Publish to staging
        working-directory: tidepush
        env:
          TIDEPUSH_SERVER_URL: ${{ secrets.TIDEPUSH_SERVER_URL }}
          TIDEPUSH_API_TOKEN: ${{ secrets.TIDEPUSH_API_TOKEN }}
          TIDEPUSH_APP_DIR: ${{ github.workspace }}/app
          # Passed via env, not pasted into the script, so quotes in a commit
          # message can't break (or inject into) the shell command.
          MESSAGE: ${{ github.event.head_commit.message || 'manual publish' }}
        run: bun run tidepush publish --channel staging -m "$MESSAGE"
```

**What it does:** checks out both repositories, installs dependencies, then runs `publish`. The CLI exports the bundle, computes the runtime version, uploads only new files and creates the update. The git commit (first 12 characters) is stored with the update, so you can trace it in the dashboard.

::: warning Never paste <code v-pre>${{ … }}</code> into `run:` scripts
Values like commit messages are attacker-controllable text. Pass them through `env:` (as above) and use the shell variable. Pasting them directly into `run:` lets a crafted commit message run commands in your CI, where your API token is available.
:::

## Promoting to production

Keep production deliberate. A manual workflow is a good fit:

```yaml
name: OTA → promote to production

on:
  workflow_dispatch:
    inputs:
      group_id:
        description: "Staging group id to promote"
        required: true
      rollout:
        description: "Rollout percentage"
        default: "10"

jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: Yug3ne/tidepush
          ref: main
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - env:
          TIDEPUSH_SERVER_URL: ${{ secrets.TIDEPUSH_SERVER_URL }}
          TIDEPUSH_API_TOKEN: ${{ secrets.TIDEPUSH_API_TOKEN }}
          GROUP_ID: ${{ inputs.group_id }}
          ROLLOUT: ${{ inputs.rollout }}
        run: bun run tidepush promote "$GROUP_ID" --to production --rollout "$ROLLOUT"
```

## Tips

- **Native changes.** If a commit changes native code, the fingerprint changes. The update is still published, but under a new runtime version that no installed build has yet, so it reaches nobody until you ship that build. That's safe, not an error.
- **Monorepos.** Point `TIDEPUSH_APP_DIR` at the folder that contains the Expo app's `package.json`.
- **Environment variables your app reads at build time** (e.g. `EXPO_PUBLIC_*`) must also be set in the publish step, because `expo export` inlines them into the bundle.
- **Token hygiene.** Use one token per CI system so you can revoke it alone. The dashboard shows when each token was last used.
