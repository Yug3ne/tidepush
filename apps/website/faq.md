# FAQ

## Do I need EAS or an Expo account?

No. You need `expo-updates` (an open-source library) in your app. You can build with `npx expo run:*`, Gradle/Xcode, or EAS Build; Tidepush doesn't care how the binary was made.

## Can I use Tidepush and EAS Update at the same time?

A build talks to one `updates.url`, so each build uses one or the other. You can move from EAS Update to Tidepush by shipping a build with the new URL and certificate.

## Does it work with Expo Go or development builds?

No. OTA updates only apply to release builds. That's how `expo-updates` works.

## Does it work with bare React Native (no CNG)?

Yes, as long as `expo-updates` is installed and configured. You'll set the update URL, channel header and certificate in the native project files instead of `app.json`. The tutorial assumes CNG because it's simpler.

## Do I need a credit card?

Cloudflare requires a payment method to enable R2, even though typical Tidepush usage stays within the free allowance.

## Is it production-ready?

It implements the Expo Updates protocol v1 with signing, staged rollouts and rollbacks, and its server tests run in the real Workers runtime. As with any self-hosted system, test the whole chain on a device (see [Testing on a device](/guides/testing-on-device)) before you rely on it.

## How fast do users get an update?

They download it on the next cold start after you publish and run it on the one after that. If you want it faster, add an in-app "update ready, restart" prompt using `expo-updates`' JavaScript API.

## Can I force users to update?

Not with Tidepush alone; that's app logic. A common pattern is to check `useUpdates()` and show a blocking screen when a critical update is pending.

## What happens if my server is down?

Apps start with what they already have (`fallbackToCacheTimeout: 0`) and try again next launch. Nobody is blocked.

## Can I have more than two channels?

Yes. Channel names are free text. For example `production`, `staging`, `qa`, `beta`.

## Can I run multiple apps on one server?

Updates are separated by channel + platform + runtime version, and runtime versions from different apps never collide in practice with the fingerprint policy. But all apps share one signing key, one admin team and one dashboard. For separate apps, a separate Worker per app is cleaner. Deploy a copy with a different `name`, database and bucket.

## Can I delete an update?

Not through the API. Roll it back instead; it's never served again and stays visible for history.

## Does Tidepush support bsdiff / patch updates?

Not yet. Devices download the full bundle when it changes, but images and fonts that didn't change are reused.

