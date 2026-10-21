---
title: "Moving from EAS Update"
---

Tidepush and EAS Update both serve the same open protocol to the same `expo-updates` library. Moving is mostly a config change and a new store build.

## What stays the same

- The `expo-updates` library, and any code that uses its JavaScript API (`useUpdates()`, `checkForUpdateAsync()`, …).
- **Runtime versions.** The same policies (`fingerprint`, `appVersion`, a fixed string) work the same way.
- **Channels**, as an idea: each build listens to one channel.
- **EAS Build.** You can keep building with it. Tidepush doesn't care how the binary was made.

## What's different

| | EAS Update | Tidepush |
| --- | --- | --- |
| Where the build asks | Expo's update URL | `https://tidepush.yugenecodes99.workers.dev/<appId>/manifest` |
| How a build picks a channel | The `channel` in `eas.json`, mapped to a branch | The `expo-channel-name` request header in your app config. No branches. |
| Publishing | `eas update` | `npx tidepush publish --channel <name>` |
| Moving an update to production | Point the channel at another branch | [Promote](/guides/channels) the update to the `production` channel |
| Code signing | Optional | On for every app. Tidepush generates the key. |

## Steps

### 1. Configure the app

From your app directory:

```sh
npx tidepush login
npx tidepush init
```

`init` creates the app in Tidepush and rewrites `updates.url`, the channel header, `codeSigningCertificate` and `codeSigningMetadata` in `app.json`. It keeps your `runtimeVersion` policy. Commit the changes and `certs/certificate.pem`.

### 2. Clean up EAS Update settings

- **Remove `channel` from the build profiles in `eas.json`.** EAS writes it into the build's `expo-channel-name` header, which would override the one Tidepush uses.
- **Don't run `eas update:configure` again.** It points `updates.url` back at Expo.
- If you build staging and production from one codebase, set the channel per build with the `app.config.ts` from [Channels & promoting](/guides/channels).

### 3. Ship a new store build

`updates.url` is built into the binary, so only a new build can switch to Tidepush. Build, test it with [Testing on a device](/guides/testing-on-device), then release it to the stores.

### 4. Publish with Tidepush

```sh
npx tidepush publish --channel production -m "First update via Tidepush"
```

Publish **after** the build. A phone ignores updates older than its build.

### 5. Run both for a while

Users who haven't installed the new build still ask EAS for updates. Until most of them have upgraded, publish urgent fixes to both:

```sh
eas update --channel production -m "Fix"
npx tidepush publish --channel production -m "Fix"
```

The **Devices** page in the dashboard shows how many devices have moved over. When the old builds are rare enough, stop publishing to EAS.

## In CI

Replace the `eas update` step with `npx tidepush publish` and a `TIDEPUSH_TOKEN` secret. See [CI/CD with GitHub Actions](/guides/ci-cd).
