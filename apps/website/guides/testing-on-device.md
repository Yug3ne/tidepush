# Testing an update end-to-end on a device

Use this checklist whenever you change your update setup (new app, new key, new Expo SDK). It proves the whole chain works before real users depend on it.

You need a **release** build of the app on a phone or emulator, pointing at the app you want to test. Debug builds never apply OTA updates.

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

Expected: the app runs its embedded bundle. Tidepush answered `noUpdateAvailable`.

## 2. Publish and receive

1. Change something visible (a text label).
2. Publish **after** the build:

   ```sh
   npx tidepush publish --channel production --platform android -m "device test"
   ```

3. Kill the app and open it. (It downloads in the background.)
4. Kill it and open it again.

Expected: you see the change. The dashboard shows the device on the new update.

## 3. Roll back

```sh
npx tidepush rollback <groupId>
```

Kill and reopen twice. Expected: the previous state comes back (the embedded bundle if this was the only update, or a republished previous update).

## 4. Staged rollout (optional)

Publish with `--rollout 0`, check the phone does **not** get it, then `rollout <id> 100` and check it does.

## Tamper check

This proves that the app rejects updates that aren't signed with your app's key. It uses a throwaway build, so your real users are never involved.

1. In the dashboard, create a second app in your organization called `signing-test`. Download its certificate from **Settings → Code signing**.
2. In your app, temporarily replace `certs/certificate.pem` with the `signing-test` certificate, and set the channel header to `tamper-test` (`TIDEPUSH_CHANNEL=tamper-test` if you use the `app.config.ts` from [Channels](/guides/channels)). **Keep `updates.url` pointing at your real app.**
3. Make a release build and install it on a test phone.
4. Publish a visible change to that channel: `npx tidepush publish --channel tamper-test --platform android -m "tamper check"`. No real build listens to `tamper-test`, so nobody else gets it.
5. Kill and reopen the app twice.

Expected: the app **does not** show the change. The logs show a code signing error (signature verification failed), and the app keeps running its embedded bundle.

Afterwards, restore your real certificate and channel (`git checkout certs/certificate.pem app.json`), uninstall the test build, and delete the `signing-test` app.

## What "good" looks like

| Check | Pass |
| --- | --- |
| Fresh install, nothing published | App runs normally and appears on the Devices page |
| Publish after build | Change visible on the 2nd cold start |
| Rollback | Previous state visible on the 2nd cold start |
| Tampered signature | Update refused, app keeps working |
| Dashboard | Device counted on the right update and runtime |

If a step fails, see [Troubleshooting](/troubleshooting).
