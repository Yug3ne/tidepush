# What is Tidepush?

Tidepush lets you send JavaScript updates to your Expo / React Native app **without a new store release**.

If you have used `eas update`, Tidepush does the same job. You sign up, create an app, point your build at it, and publish updates from your terminal or CI.

## The short version

- Your app uses the official **`expo-updates`** library. You do not add any Tidepush code to the app.
- You change one setting in the app (`updates.url`) so it asks Tidepush for updates: `https://u.tidepush.dev/<appId>/manifest`.
- You publish updates with **`npx tidepush`**, run from your Expo app directory. There is nothing to install or clone.
- You watch and control updates in the **dashboard** at `https://app.tidepush.dev`.

## What you get

| Feature | What it means for you |
| --- | --- |
| Stock `expo-updates` client | Nothing custom in the app. Follow Expo's own docs for the client side. |
| Signed manifests | The app checks a signature on every update. A stolen update URL or API token is not enough to run unsigned code on your users' phones. |
| Channels | Separate lines of updates, for example `staging` and `production`. |
| Staged rollouts | Send an update to 10% of devices first, then widen it. |
| Rollback | Undo a bad update in one command. |
| Promote | Copy a tested staging update to production without rebuilding it. |
| Dashboard | See updates, device adoption and an audit log. Manage your team, apps and API tokens. |
| Teams | An organization holds your apps and members, with owner, admin and read-only roles. See [Team & access](/guides/team-and-access). |

## What Tidepush is not

- **Not a build service.** It does not build your APK or IPA. You still build those yourself (or with EAS Build) and ship them through the stores.
- **Not a way to change native code.** OTA updates can only change JavaScript and assets such as images. Read [What are OTA updates?](/guide/ota-updates) for the exact line.

## Who it is for

Teams that ship an Expo app (SDK with `expo-updates`) and want:

- staged rollouts, rollbacks and promotion without running their own server,
- predictable cost based on active devices (see [Plans & limits](/reference/limits)),
- a way out: Tidepush is open source, so they are never locked in.

::: info Open source
Tidepush is open source under the AGPL. Teams that must run it on their own infrastructure can: see [Self-hosting](/self-hosting).
:::

## Where to go next

1. New to OTA updates? Read [What are OTA updates?](/guide/ota-updates).
2. Learn the words used everywhere in these docs: [Key concepts](/guide/concepts).
3. Ready to try it? Follow the [Getting started tutorial](/guide/getting-started).
