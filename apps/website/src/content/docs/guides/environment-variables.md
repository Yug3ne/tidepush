---
title: "Environment variables"
---

Expo puts every `EXPO_PUBLIC_*` variable into the JavaScript bundle when it exports your app. Those values usually live in a `.env` file that isn't in Git, so each person who publishes needs their own copy. If a copy is missing, `expo export` doesn't fail: it bundles empty values, and the update that goes out can't reach your API.

Tidepush can keep these variables for you. `tidepush publish` reads them from the server and passes them to `expo export`, so every update is built with the same values, whoever publishes it and from whichever machine.

## Add your variables

Sign in first. Changing variables needs a person who is an **admin** or **owner**, not an API token.

```sh
npx tidepush login
```

Import the `.env` file you already have:

```sh
npx tidepush env import .env
```

```text
  Left out (not EXPO_PUBLIC_*, or empty): SENTRY_AUTH_TOKEN
✔ Saved 3 variables for all channels
  EXPO_PUBLIC_API_URL
  EXPO_PUBLIC_AUTH_URL
  EXPO_PUBLIC_POSTHOG_KEY
```

Or set them one at a time:

```sh
npx tidepush env set EXPO_PUBLIC_API_URL=https://api.example.com
```

## Different values per channel

Without `--channel`, a variable applies to every channel. Add `--channel` to set a value for one channel only. That value wins over the shared one when you publish to that channel.

```sh
npx tidepush env set EXPO_PUBLIC_API_URL=https://api.example.com
npx tidepush env set EXPO_PUBLIC_API_URL=https://staging.example.com --channel staging
```

| You publish to | `EXPO_PUBLIC_API_URL` in the bundle |
| --- | --- |
| `staging` | `https://staging.example.com` |
| any other channel | `https://api.example.com` |

## Publishing

Nothing changes in how you publish. The CLI names the variables it uses, never their values:

```text
• Using 3 variables from the server for production:
  EXPO_PUBLIC_API_URL, EXPO_PUBLIC_AUTH_URL, EXPO_PUBLIC_POSTHOG_KEY
• Exporting ios + android bundle(s) and reading the app config…
```

- **Server values win.** They replace the same variable from a local `.env` file or from the shell. Variables you haven't put on the server still come from `.env` as before.
- **No values, no publish.** If the CLI can't read the variables (network error, expired login, a read-only role), it stops before exporting.
- **`--dist` skips them.** A bundle you exported yourself is already built, so the server's variables aren't applied to it.
- **`--dry-run` skips them too**, because a dry run doesn't sign in.

## See and remove variables

```sh
npx tidepush env list
npx tidepush env rm EXPO_PUBLIC_OLD_FLAG
npx tidepush env rm EXPO_PUBLIC_API_URL --channel staging
```

`env list` shows names, channel, and who changed each one and when. It never shows values. To check a value, set it again.

## Who can do what

| | owner, admin | member | API token |
| --- | --- | --- | --- |
| See names | yes | yes | yes |
| Set and remove | yes, signed in | no | no |
| Read values when publishing | yes | no | yes |

API tokens can read the values, because CI needs them to publish. They can't change them, so a leaked CI token can't alter what later updates are built with.

## How the values are protected

| Control | Detail |
| --- | --- |
| Encryption at rest | Each value is encrypted with AES-256-GCM before it is stored. The key is not in the database. |
| Bound to its place | A stored value only decrypts for the app, channel and name it was saved under, so it can't be copied to another app. If a stored value has been tampered with, publishing fails. |
| Never listed | The API and CLI list names only. Values are returned in one place: to someone who can publish to the app, when they publish. |
| Audit log | Every change and every read is recorded with who did it. Values are never written to the log. |
| Separation | Variables belong to one app. A request from another organization gets `404`. |

:::caution[`EXPO_PUBLIC_*` values are not secret from your users]
Anything in an `EXPO_PUBLIC_*` variable ends up readable inside the app on every phone. Tidepush protects these values on the server and controls who can change them. It can't hide them from someone who inspects your app. Never put a private key, a database password or a server-side API secret in one.
:::

Only `EXPO_PUBLIC_*` names are accepted, by the server and by the CLI. The variables are passed to a command on the machine that publishes, and a name such as `PATH` or `NODE_OPTIONS` could be used to run code there.

Limits: 100 variables per channel (and 100 shared), 4096 characters per value, no line breaks.

:::tip[Self-hosted servers]
Environment variables need the `KEY_ENCRYPTION_KEY` secret on the API Worker, the same one that protects signing keys. See [Self-hosting](/self-hosting).
:::
