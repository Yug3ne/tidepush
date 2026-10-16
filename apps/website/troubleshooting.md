# Troubleshooting

Start with the device logs. They usually say exactly what happened.

```sh
adb logcat | grep -i -E "expo-updates|ExpoUpdates|dev.expo.updates"
```

On iOS: Console.app → your device → filter for `expo-updates`.

## The app never picks up my update

Work through these in order.

### 1. Is it a release build?

`expo-updates` does nothing in debug / development builds (anything connected to Metro). Build with `npx expo run:android --variant release` or `npx expo run:ios --configuration Release`, or a store / EAS build.

### 2. Did you relaunch twice?

The first cold start downloads the update; the second runs it. "Cold start" means fully closing the app (swipe it away), not just switching apps.

### 3. Do the runtime versions match?

The update is only offered to builds with the **exact same** runtime version.

- Compare the runtime in `npx tidepush list` with the one in the dashboard's Devices page for your phone.
- Or ask Expo what the app's current code resolves to:

  ```sh
  cd ~/my-app
  npx expo-updates runtimeversion:resolve --platform android
  ```

Common causes of a mismatch with the `fingerprint` policy:

- You changed a native dependency, a config plugin or `app.json` after building. That's working as intended: rebuild.
- Different `node_modules` between the build machine and the publish machine. Install with the same lockfile on both.
- Staging vs production builds without the [`fingerprint.config.js`](/guides/channels#the-problem-this-creates-and-fingerprint-config-js) hook.
- Environment variables that change the app config (`app.config.ts`) differ between build and publish.

### 4. Was the update published after the build?

Phones ignore updates older than their own build. If you published, then built, then installed: publish again.

### 5. Is the channel right?

The build sends `expo-channel-name`. Check what it was built with:

```sh
npx expo config --type public | grep -A3 requestHeaders
```

- With `app.config.ts`, the channel comes from `TIDEPUSH_CHANNEL` **at prebuild time**. Did you run `npx expo prebuild --clean` with the right value?
- With **EAS Build**, a `channel` in `eas.json` overrides the header. Remove it or make it match.

### 6. Is the rollout at 100%?

At a lower percentage your device may simply not be in the bucket. Try `npx tidepush rollout <id> 100`.

### 7. Is the URL right?

`updates.url` must be your app's address, `https://tidepush.yugenecodes99.workers.dev/<appId>/manifest`, with the app id shown on the app's page in the dashboard. Open `https://tidepush.yugenecodes99.workers.dev/<appId>/manifest?platform=android&runtime-version=x&channel=production` in the phone's browser: you should get a small multipart response, not an error page. A `404` means the app id is wrong.

### 8. Signature problems

Logs mention code signing, signature or certificate:

- The app's `certs/certificate.pem` doesn't belong to this app's signing key. Compare it with the certificate in the app's **Settings → Code signing**. A different certificate needs a new build. See [Code signing & keys](/guides/code-signing).
- `codeSigningMetadata.keyid` in the app doesn't match a key id listed in **Settings → Code signing**. Both default to `main`.
- The key the build trusts was retired. Builds made with it can't get signed updates anymore; ship a new build.

## The app went back to an old version

- Someone rolled back: check the dashboard's audit log.
- The update crashed on launch. `expo-updates` automatically falls back to the previous working update if a new one crashes before it's ready. Check your crash reports for the new bundle.

## CLI errors

### `Not logged in`

Run `npx tidepush login`. In CI, set `TIDEPUSH_TOKEN` to an API token.

### `401: Unauthorized`

Your login expired, or the token is wrong or was revoked. Run `npx tidepush login` again, or create a new token in **Settings → API tokens**.

### `403`

- The token is restricted to a different app.
- Your role is **member**, which is read-only. Ask an owner for **admin**.
- Managing members, tokens, billing or keys needs a signed-in owner, not a token.

### `404: App not found`

The app id from `updates.url` (or `--app`) doesn't exist, or belongs to an organization you're not in. Check the app id in the dashboard, and run the command from the right app directory.

### `402: Publishing paused`

Your organization went over its plan limits more than 7 days ago. Phones still get updates; only publishing is paused. Upgrade or check usage in **Dashboard → Billing**. See [Limits](/reference/limits).

### `409: missing assets: …`

Some files weren't uploaded before the update was created, usually after a failed upload. Run `publish` again; finished uploads are skipped.

### `413: asset too large`

A file is over 95 MB. See [Limits](/reference/limits).

### `does not depend on expo-updates`

You ran the CLI outside your app, or `--app-dir` / `TIDEPUSH_APP_DIR` points at the wrong folder. It must contain the Expo app's `package.json`.

### `Could not resolve a runtime version`

Your app config has no `runtimeVersion`. Add `"runtimeVersion": { "policy": "fingerprint" }`, or run `npx tidepush init`.

### `npx expo export … exited 1`

The export itself failed; the lines above show Expo's error. Run `npx expo export` in the app directly to debug. Install the app's dependencies first.

## Dashboard problems

### `429 Too many failed sign-in attempts`

Wait the number of seconds shown (at most 15 minutes). Five wrong passwords for one email, or twenty from one IP, trigger it. Or sign in with GitHub, or reset your password.

### Invite link says used or expired

Invites work once and last 72 hours. Ask an owner for a new one.

### I can't see an app my teammate sees

Apps belong to organizations. Check the organization switcher in the top bar, and ask an owner to invite you if you're not a member.

### I'm locked out

See [Recovering access](/guides/team-and-access).
