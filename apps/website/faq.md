# FAQ

## Do I need a credit card?

No. The free plan needs no card. You only add one when you move to a paid plan in **Dashboard → Billing**.

## Do I need EAS or an Expo account?

No. You need `expo-updates` (an open-source library) in your app. You can build with `npx expo run:*`, Gradle/Xcode, or EAS Build; Tidepush doesn't care how the binary was made.

## Can I use Tidepush and EAS Update at the same time?

A build talks to one `updates.url`, so each build uses one or the other. You can keep EAS Build for building and use Tidepush for updates. To switch an app over, ship a build with the Tidepush URL and certificate. See [Moving from EAS Update](/guides/moving-from-eas).

## Can I have more than one app?

Yes. Create one Tidepush app per Expo app. Each app has its own update URL, its own signing key, and its own updates, channels and devices. How many apps you can have depends on your plan; see [Plans & limits](/reference/limits).

## What happens if I go over my plan's limits?

Phones keep getting updates. Always. The dashboard shows a warning, and after a 7-day grace period **publishing** is paused until you upgrade or usage drops. See [Plans & limits](/reference/limits).

## Is my code safe?

- Every manifest is signed with your app's private key, and the app checks the signature against the certificate built into it. Without that key, nobody can get your app to run their code.
- Private keys are encrypted at rest and only decrypted in memory while signing.
- Only owners can export a key, and exports are recorded in the audit log.
- If you'd rather Tidepush never generated your key, an owner can upload your own instead.

See [Code signing & keys](/guides/code-signing) and [Security](/reference/security).

## Can I leave, or move to self-hosting?

Yes. Tidepush is open source (AGPL), so you can run the same server yourself:

1. An owner exports the app's private key from the app's **Settings → Code signing**.
2. Run the open-source version with that key. See [Self-hosting](/self-hosting).
3. Builds already on phones ask `tidepush.yugenecodes99.workers.dev` for updates, and only a new build can change that. Plan a store build that points `updates.url` at your own server. With the exported key, that build can keep the same certificate. Keep publishing to Tidepush for older builds until most users have the new one.

## Does it work with Expo Go or development builds?

No. OTA updates only apply to release builds. That's how `expo-updates` works.

## Does it work with bare React Native (no CNG)?

Yes, as long as `expo-updates` is installed and configured. You'll set the update URL, channel header and certificate in the native project files instead of `app.json`. The tutorial assumes CNG because it's simpler.

## How fast do users get an update?

They download it on the next cold start after you publish and run it on the one after that. If you want it faster, add an in-app "update ready, restart" prompt using `expo-updates`' JavaScript API.

## Can I force users to update?

Not with Tidepush alone; that's app logic. A common pattern is to check `useUpdates()` and show a blocking screen when a critical update is pending.

## What happens if Tidepush is down?

Apps start with what they already have (`fallbackToCacheTimeout: 0`) and try again next launch. Nobody is blocked.

## Can I have more than two channels?

Yes. Channel names are free text. For example `production`, `staging`, `qa`, `beta`.

## Can I delete an update?

Not through the CLI or dashboard. Roll it back instead; it's never served again and stays visible for history.

## Does Tidepush support bsdiff / patch updates?

Not yet. Devices download the full bundle when it changes, but images and fonts that didn't change are reused.
