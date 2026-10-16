# CLI reference

The `tidepush` CLI publishes and manages updates. Run it with `npx` from your Expo app directory:

```sh
npx tidepush <command> [options]
npx tidepush help
```

It needs Node.js 20.12 or newer. `npx tidepush --version` prints the version. To pin a version (recommended in CI), add `tidepush` to your app's `devDependencies`.

## Authentication

| Where | How |
| --- | --- |
| Your machine | `npx tidepush login`. Credentials are saved in `~/.config/tidepush/credentials.json`. |
| CI and scripts | Set `TIDEPUSH_TOKEN` to an API token (`tp_…`) from **Dashboard → Settings → API tokens**. |

If `TIDEPUSH_TOKEN` is set, it's used instead of the saved login.

## Which app

Commands act on one app. The CLI reads the app id from `updates.url` in your app config (`https://tidepush.yugenecodes99.workers.dev/<appId>/manifest`), so running it from the app directory is enough. Override it with `--app <appId>`.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `TIDEPUSH_TOKEN` | API token for CI and scripts. |
| `TIDEPUSH_APP_DIR` | Path to the Expo app. Defaults to the current directory. `--app-dir` overrides it. |

Variables the CLI **sets** for the commands it runs in your app:

| Variable | Value |
| --- | --- |
| `TIDEPUSH_CHANNEL` | The `--channel` you publish to. Your `app.config.ts` can read it (see [Channels](/guides/channels)). |
| `CI` | `1`, so Expo tools don't prompt. |

### Global options

| Option | Meaning |
| --- | --- |
| `--app <appId>` | Use this app instead of the one in `updates.url`. |
| `--app-dir <dir>` | The Expo app directory. |

### Errors

On failure the CLI prints `✖ <message>` and exits with code 1. API errors include the method, path, status and message, for example:

```text
✖ GET /updates?channel=staging → 401: Unauthorized
```

| Status | Usual cause |
| --- | --- |
| `401` | Not logged in, login expired, or the token was revoked. |
| `403` | The token is restricted to another app, or your role is read-only. |
| `404` | The app id doesn't exist or isn't in your organization. |
| `402` | Publishing is paused because the organization is over its plan limits. See [Limits](/reference/limits). |

More in [Troubleshooting](/troubleshooting).

## `login`

Signs the CLI in to your account.

```sh
npx tidepush login
```

It opens your browser on a page that asks you to approve the CLI, and shows a short code to compare with the one in the terminal. On a machine without a browser it prints the link to open elsewhere.

```text
✔ Logged in as you@example.com
```

## `logout`

Removes the saved credentials from this machine and revokes them.

```sh
npx tidepush logout
```

## `init`

Connects an Expo app to a Tidepush app.

```sh
npx tidepush init [--app <appId>]
```

It asks you to pick an organization and an app, or to create a new app, then:

1. saves the app's certificate as `certs/certificate.pem`,
2. writes `updates.url`, `updates.requestHeaders["expo-channel-name"]` (default `production`), `codeSigningCertificate` and `codeSigningMetadata` into `app.json`,
3. sets `runtimeVersion` to `{ "policy": "fingerprint" }` if it isn't set, and keeps it otherwise.

If your config is in `app.config.ts`, `init` prints the values to add instead of editing the file.

```text
✔ Created app "My App" (app_7f3k2m9q)
✔ Saved certs/certificate.pem
✔ Updated app.json
```

## `publish`

Exports your app and creates an update (one per platform, sharing a group id).

```sh
npx tidepush publish --channel <name> [options]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--channel <name>` | required | Channel to publish to. Letters, digits, `.`, `_`, `-`; up to 64 characters. |
| `--platform ios\|android\|all` | `all` | Which platforms to export and publish. |
| `--rollout <pct>` | `100` | Initial rollout percentage, 0–100. |
| `-m, --message <text>` | none | Description shown in the dashboard and `list`. Up to 1000 characters. |
| `--app-dir <dir>` | `TIDEPUSH_APP_DIR` or current dir | The Expo app. Its `package.json` must depend on `expo-updates`. |
| `--runtime-version <v>` | resolved | Use this runtime version instead of asking Expo. Only for special cases; a wrong value means no device gets the update. |
| `--dist <dir>` | export to a temp dir | Use an existing `expo export` output folder instead of exporting. |
| `--dry-run` | off | Do everything except upload. Shows what would be uploaded. Needs no login. |

What it runs, in your app directory, with `TIDEPUSH_CHANNEL=<channel>`:

1. `npx expo export --platform <p> … --output-dir <tmp>` (skipped with `--dist`)
2. `npx expo config --type public --json` (stored with the update as `extra.expoClient`)
3. `npx expo-updates runtimeversion:resolve --platform <p>` for each platform (skipped with `--runtime-version`)
4. `git rev-parse HEAD` and `git status --porcelain`. The first 12 characters of the commit are stored; `-dirty` is added if you have uncommitted changes, with a warning.

Then it hashes every file, asks Tidepush which are missing, uploads those (6 at a time, retrying network errors and 5xx up to 4 times), and creates the update.

Example output:

```text
• Exporting ios + android bundle(s)…
• Reading app config and runtime version…
  ios      runtime 3f9c1a7e…  bundle 7.9 MB  42 assets
  android  runtime 3f9c1a7e…  bundle 8.1 MB  42 assets
• Uploading 2/86 files (16.0 MB)…
✔ Published to staging at 100% (group 7c1e0b52-3a1f-4e0b-9d55-4c5e9a0f1b2d)
  ios      9b0e6c1d-2f4a-4c51-9d7e-0f3a5b8c1e22
  android  4f2a8e77-91c3-4b8a-a1d0-6e2b9c7f3a10
```

Dry run:

```text
✔ Dry run: 86 unique files, 18.2 MB. Nothing uploaded.
```

## `list`

Lists recent updates, newest first.

```sh
npx tidepush list [--channel <name>] [--platform ios|android] [--runtime-version <v>] [--limit <n>] [--json]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--channel` | all | Filter by channel. |
| `--platform` | all | Filter by platform. |
| `--runtime-version` | all | Filter by runtime version. |
| `--limit <n>` | 50 | Up to 500. |
| `--json` | off | Print the raw JSON instead of a table. |

The table shows: created time, channel, platform, runtime (first 10 characters), id, group (first 8 characters), rollout, status, devices currently on it, and message. With no updates it prints `No updates.`

## `promote`

Copies an update (or every active update in a group) to another channel.

```sh
npx tidepush promote <updateOrGroupId> --to <channel> [--rollout <pct>]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--to <channel>` | required | Target channel. |
| `--rollout <pct>` | `100` | Rollout percentage for the copies. |

```text
✔ Promoted 7c1e0b52-… to production (group 2d9f4c11-…)
  android  8a1b…
  ios      c03e…
```

Only `active` updates are promoted. Fails with `404` if none match.

## `rollout`

Sets the rollout percentage of an update or group.

```sh
npx tidepush rollout <updateOrGroupId> <pct>
```

```text
✔ Rollout set to 50% for android 4f2a…, ios 9b0e…
```

## `rollback`

Rolls back an update or group. See [Rollbacks](/guides/rollbacks) for exactly what happens.

```sh
npx tidepush rollback <updateOrGroupId> [--to-embedded]
```

| Option | Meaning |
| --- | --- |
| `--to-embedded` | Roll back every active update in the line, and send devices back to the embedded bundle. |

One line per platform:

```text
✔ android  4f2a…: previous update republished as 6d0c…
✔ ios      9b0e…: devices will roll back to the embedded bundle
```

Possible outcomes: `previous update republished as <id>`, `devices will roll back to the embedded bundle`, or `rolled back`.

## `help`

```sh
npx tidepush help      # also: --help, -h, or no command
```
