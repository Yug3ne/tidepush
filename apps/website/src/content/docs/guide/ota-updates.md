---
title: "What are OTA updates?"
---

**OTA** means "over the air". An OTA update changes your app on people's phones without them installing a new version from the App Store or Play Store.

## Two halves of a React Native app

A React Native app is made of two parts:

```text
┌──────────────────────────── Your app (.apk / .ipa) ────────────────────────────┐
│                                                                                │
│   Native code                          JavaScript bundle + assets              │
│   ─────────────                        ──────────────────────────              │
│   Java/Kotlin, Swift/Objective-C        Your screens, logic, styles, text,     │
│   React Native itself                   images and fonts used by JS            │
│   Native modules (camera, biometrics,                                          │
│   push notifications, …)                                                       │
│   Permissions, app icon, splash screen                                         │
│                                                                                │
│   Changed only by a new store build     Can be replaced by an OTA update       │
└────────────────────────────────────────────────────────────────────────────────┘
```

When you build a release app, the JavaScript bundle is put inside it. This copy is called the **embedded bundle**. Without OTA, the app runs the embedded bundle forever, until the user installs a new version.

With `expo-updates`, the app can download a **newer** JavaScript bundle (and its images) from a server, save it, and run that instead.

## What you can change with an OTA update

- Bug fixes in your JavaScript or TypeScript code
- Text, copy, translations
- Styles and layouts
- Images and fonts that are imported from JavaScript
- New screens, as long as they only use native modules that are already in the build

## What you cannot change with an OTA update

- Adding, removing or upgrading a library that has native code (for example a new camera or payments SDK)
- Upgrading Expo SDK or React Native
- App permissions, app icon, splash screen, app name
- Anything in `android/` or `ios/`, and most things in `app.json` that end up in native files

For these you need a new build and a store release. To stop an OTA update from landing on a build that can't run it, every build has a **runtime version** (explained in [Key concepts](/guide/concepts#runtime-version)). An update is only sent to builds with the same runtime version.

:::tip[The safe rule]
If you changed a `package.json` dependency that has native code, or anything under `android/` or `ios/`, you need a new build. With the `fingerprint` runtime policy, Expo works this out for you.
:::

## When does the phone get the update?

With the usual settings (`checkAutomatically: "ON_LOAD"` and `fallbackToCacheTimeout: 0`):

1. **Launch 1:** the app starts with what it already has. In the background it asks the server for something newer, and downloads it if there is.
2. **Launch 2:** the app starts with the new update.

So after you publish, a user sees the change the **second** time they cold-start the app (close it fully and reopen). This is why the tutorial tells you to "relaunch twice".

:::note[Apps that stay open]
Many people leave apps open for days. `expo-updates` also has JavaScript APIs (`useUpdates()`, `checkForUpdateAsync()`, `fetchUpdateAsync()`, `reloadAsync()`) so you can check when the app returns to the foreground and offer a "Restart to update" button. That is app code you write; Tidepush works with it unchanged.
:::

## Store rules

Both Apple and Google allow OTA updates of interpreted code like JavaScript, as long as the update doesn't change the app's main purpose or sneak in features that would fail review. Use OTA for fixes and small improvements, and ship big changes through the store.

Next: [Key concepts](/guide/concepts).
