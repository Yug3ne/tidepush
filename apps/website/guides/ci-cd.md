# CI/CD with GitHub Actions

This guide publishes an update to the **staging** channel every time you push to `main` in your app repository.

The CLI runs with `npx`, so the workflow only needs your app's own repository.

## 1. Create an API token for CI

Dashboard → **Settings → API tokens** → create one named `github-actions`.

- Restrict it to the app this repository publishes. If the token ever leaks, it can only touch that one app.
- Copy the `tp_…` value. It is shown only once.

## 2. Add a repository secret

In your app repository on GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value |
| --- | --- |
| `TIDEPUSH_TOKEN` | The `tp_…` token |

The CLI finds the app from `updates.url` in your app config, so there's nothing else to configure.

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
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci   # or: bun install --frozen-lockfile / yarn install --frozen-lockfile

      - name: Publish to staging
        env:
          TIDEPUSH_TOKEN: ${{ secrets.TIDEPUSH_TOKEN }}
          # Passed via env, not pasted into the script, so quotes in a commit
          # message can't break (or inject into) the shell command.
          MESSAGE: ${{ github.event.head_commit.message || 'manual publish' }}
        run: npx tidepush publish --channel staging -m "$MESSAGE"
```

**What it does:** checks out your app, installs dependencies, then runs `publish`. The CLI exports the bundle, computes the runtime version, uploads only new files and creates the update. The git commit (first 12 characters) is stored with the update, so you can trace it in the dashboard.

::: tip Pin the CLI version
`npx tidepush` runs the latest version. To make CI repeatable, add `tidepush` to your app's `devDependencies` with a fixed version. `npx` then uses that one.
:::

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
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - env:
          TIDEPUSH_TOKEN: ${{ secrets.TIDEPUSH_TOKEN }}
          GROUP_ID: ${{ inputs.group_id }}
          ROLLOUT: ${{ inputs.rollout }}
        run: npx tidepush promote "$GROUP_ID" --to production --rollout "$ROLLOUT"
```

The checkout is there so the CLI can read `updates.url` from your app config. Without it, pass `--app <appId>`.

You can also promote from the dashboard's Updates page.

## Tips

- **Native changes.** If a commit changes native code, the fingerprint changes. The update is still published, but under a new runtime version that no installed build has yet, so it reaches nobody until you ship that build. That's safe, not an error.
- **Monorepos.** Run the publish step with `working-directory:` set to the folder that contains the Expo app's `package.json`, or pass `--app-dir`.
- **Environment variables your app reads at build time** (e.g. `EXPO_PUBLIC_*`) must also be set in the publish step, because `expo export` inlines them into the bundle.
- **Token hygiene.** Use one token per CI system so you can revoke it alone. The dashboard shows when each token was last used.
