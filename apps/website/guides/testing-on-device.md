# Testing an update end-to-end on a device

Use this checklist whenever you change your update setup (new server, new domain, new key, new Expo SDK). It proves the whole chain works before real users depend on it.

You need a **release** build of the app on a phone or emulator, pointing at the server you want to test. Debug builds never apply OTA updates.

## Watch the logs

Keep the device logs open while testing. They tell you exactly why an update was or wasn't applied.

```sh
# Android
adb logcat | grep -i -E "expo-updates|ExpoUpdates|dev.expo.updates"
```

On iOS, use Console.app, select the device, and filter for `expo-updates` or your app's name.

## 1. Fresh build, nothing published

1. Make a release build and install it (`npx expo run:android --variant release`).
2. Open the app.
3. In the dashboard, the device appears under the runtime version once it has checked in (Devices page).

Expected: the app runs its embedded bundle. The server answered `noUpdateAvailable`.

## 2. Publish and receive

1. Change something visible (a text label).
2. Publish **after** the build:

   ```sh
   bun run tidepush publish --channel production --platform android -m "device test"
   ```

3. Kill the app and open it. (It downloads in the background.)
4. Kill it and open it again.

Expected: you see the change. The dashboard shows the device on the new update.

## 3. Roll back

```sh
bun run tidepush rollback <groupId>
```

Kill and reopen twice. Expected: the previous state comes back (the embedded bundle if this was the only update, or a republished previous update).

## 4. Staged rollout (optional)

Publish with `--rollout 0`, check the phone does **not** get it, then `rollout <id> 100` and check it does.

## Tamper check

This proves that the app rejects updates that aren't signed by your key. Do it once against a **local** server, never production.

1. Run Tidepush locally (see [Local development](/guides/local-development)) with your **real** private key, and point a release build at it (LAN IP or tunnel).
2. Publish an update and confirm the phone receives it.
3. Generate a different key and restart the local server with it:

   ```sh
   scripts/dev-vars.sh        # no argument = a new throwaway key
   bun run dev
   ```

4. Publish another visible change.
5. Kill and reopen the app twice.

Expected: the app **does not** show the second change. The logs show a code signing error (signature verification failed), and the app keeps running the last good update.

Restore your real key afterwards: `scripts/dev-vars.sh path/to/private-key.pem`. (Re-running the script also writes a new `SETUP_TOKEN`; that doesn't matter once an owner exists in the local database.)

## What "good" looks like

| Check | Pass |
| --- | --- |
| Fresh install, nothing published | App runs normally, server logs a `noUpdateAvailable` |
| Publish after build | Change visible on the 2nd cold start |
| Rollback | Previous state visible on the 2nd cold start |
| Tampered signature | Update refused, app keeps working |
| Dashboard | Device counted on the right update and runtime |

If a step fails, see [Troubleshooting](/troubleshooting).
