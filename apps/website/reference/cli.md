# CLI reference

The `tidepush` CLI publishes and manages updates. It lives in `packages/cli` and runs with Bun from the repository root:

```sh
bun run tidepush <command> [options]
bun run tidepush help
```

Every command except `publish --dry-run` talks to your server's admin API with an API token.

## Configuration

The CLI reads environment variables. Bun loads a `.env` file from the directory you run it in automatically, so the usual setup is `~/tidepush/.env` (start from `.env.example`; `.env` is gitignored).

| Variable | Required | Meaning |
| --- | --- | --- |
| `TIDEPUSH_SERVER_URL` | Yes (or `--server`) | Your server, e.g. `https://ota.example.com`. No `/manifest`, no trailing slash needed. |
| `TIDEPUSH_API_TOKEN` | Yes | A `tp_…` token from **Dashboard → Settings → API tokens** (or a break-glass `ADMIN_API_TOKENS` entry). |
| `TIDEPUSH_APP_DIR` | For `publish` | Path to the Expo app. Defaults to the current directory. `--app-dir` overrides it. |
| `TIDEPUSH_ACCESS_CLIENT_ID` | Only behind Access | Cloudflare Access service token id. |
| `TIDEPUSH_ACCESS_CLIENT_SECRET` | Only behind Access | Cloudflare Access service token secret. |

```sh
# ~/tidepush/.env
TIDEPUSH_SERVER_URL=https://ota.example.com
TIDEPUSH_API_TOKEN=tp_…
TIDEPUSH_APP_DIR=/home/you/my-app
```

Variables the CLI **sets** for the commands it runs in your app:

| Variable | Value |
| --- | --- |
| `TIDEPUSH_CHANNEL` | The `--channel` you publish to. Your `app.config.ts` can read it (see [Channels](/guides/channels)). |
| `CI` | `1`, so Expo tools don't prompt. |

### Global options

| Option | Meaning |
| --- | --- |
| `--server <url>` | Overrides `TIDEPUSH_SERVER_URL` for this run. |

### Errors

On failure the CLI prints `✖ <message>` and exits with code 1. API errors include the method, path, status and the server's message, for example:

```text
✖ GET /updates?channel=staging → 401: Unauthorized
```

## `publish`

Exports your app and creates an update (one per platform, sharing a group id).

```sh
bun run tidepush publish --channel <name> [options]
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
| `--dry-run` | off | Do everything except contact the server. Shows what would be uploaded. Needs no token. |

What it runs, in your app directory, with `TIDEPUSH_CHANNEL=<channel>`:

1. `npx expo export --platform <p> … --output-dir <tmp>` (skipped with `--dist`)
2. `npx expo config --type public --json` (stored with the update as `extra.expoClient`)
3. `npx expo-updates runtimeversion:resolve --platform <p>` for each platform (skipped with `--runtime-version`)
4. `git rev-parse HEAD` and `git status --porcelain`. The first 12 characters of the commit are stored; `-dirty` is added if you have uncommitted changes, with a warning.

Then it hashes every file, asks the server which are missing, uploads those (6 at a time, retrying network errors and 5xx up to 4 times), and creates the update.

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
bun run tidepush list [--channel <name>] [--platform ios|android] [--runtime-version <v>] [--limit <n>] [--json]
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
bun run tidepush promote <updateOrGroupId> --to <channel> [--rollout <pct>]
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
bun run tidepush rollout <updateOrGroupId> <pct>
```

```text
✔ Rollout set to 50% for android 4f2a…, ios 9b0e…
```

## `rollback`

Rolls back an update or group. See [Rollbacks](/guides/rollbacks) for exactly what happens.

```sh
bun run tidepush rollback <updateOrGroupId> [--to-embedded]
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
bun run tidepush help      # also: --help, -h, or no command
```
