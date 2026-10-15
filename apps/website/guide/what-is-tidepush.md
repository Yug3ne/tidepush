# What is Tidepush?

Tidepush lets you send JavaScript updates to your Expo / React Native app **without a new store release**, using a server that you run yourself on Cloudflare.

If you have used `eas update`, Tidepush does the same job. The difference is where the updates live: on your own Cloudflare account instead of Expo's hosted service.

## The short version

- Your app uses the official **`expo-updates`** library. You do not add any Tidepush code to the app.
- You change one setting in the app (`updates.url`) so it asks **your** server for updates.
- Tidepush is that server. It is one **Cloudflare Worker** (a small program that runs on Cloudflare's network), plus a **D1** database and an **R2** storage bucket.
- You publish updates with the **`tidepush` CLI**, and you watch and control them in a **dashboard** in your browser.

<ArchDiagram caption="The app talks to one Worker. The Worker keeps update details in D1 and files in R2." />

## What you get

| Feature | What it means for you |
| --- | --- |
| Stock `expo-updates` client | Nothing custom in the app. Follow Expo's own docs for the client side. |
| Signed manifests | The app checks a signature on every update. A stolen server URL is not enough to push code to your users. |
| Channels | Separate lines of updates, for example `staging` and `production`. |
| Staged rollouts | Send an update to 10% of devices first, then widen it. |
| Rollback | Undo a bad update in one command. |
| Promote | Copy a tested staging update to production without rebuilding it. |
| Dashboard | See updates, device adoption and an audit log. Manage admins and API tokens. |
| Low cost | Usually $0–5 per month. See [Costs & limits](/reference/costs). |

## What Tidepush is not

- **Not a build service.** It does not build your APK or IPA. You still build those yourself (or with EAS Build) and ship them through the stores.
- **Not a way to change native code.** OTA updates can only change JavaScript and assets such as images. Read [What are OTA updates?](/guide/ota-updates) for the exact line.
- **Not a hosted product.** You run it on your own Cloudflare account. Nobody else holds your keys or your data.

## Who it is for

Teams that ship an Expo app (SDK with `expo-updates`) and want:

- control over where their code and data live (for example, a regulated app such as a payments app),
- predictable, low cost,
- or simply to avoid depending on a third-party update service.

## The pieces in the repository

| Folder | What it is |
| --- | --- |
| `apps/server` | The Cloudflare Worker (written with [Hono](https://hono.dev)). Database migrations live in `apps/server/migrations`. |
| `apps/dashboard` | The dashboard web app. It is built into the Worker, so it is served from the same address. |
| `packages/cli` | The `tidepush` CLI. You run it with `bun run tidepush …` from the repository root. |
| `apps/website` | This website and documentation. |

## Where to go next

1. New to OTA updates? Read [What are OTA updates?](/guide/ota-updates).
2. Learn the words used everywhere in these docs: [Key concepts](/guide/concepts).
3. Ready to try it? Follow the [Getting started tutorial](/guide/getting-started).
