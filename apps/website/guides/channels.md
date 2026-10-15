# Channels & promoting

A **channel** is a named line of updates. A build listens to exactly one channel, chosen when the build is made. The most common setup is two channels:

| Channel | Who has builds on it | What you publish there |
| --- | --- | --- |
| `staging` | You and your testers (internal APKs, TestFlight) | Every change, as soon as it's merged |
| `production` | Everyone who installed from the stores | Only changes that passed testing on staging |

Channel names are free text: letters, digits, `.`, `_` and `-`, up to 64 characters, starting with a letter or digit.

## How a build picks its channel

The app sends the header `expo-channel-name` on every update check. You set it in the app config:

```json
"updates": {
  "requestHeaders": { "expo-channel-name": "production" }
}
```

That value is written into the native project at `prebuild` time. To change a build's channel you need a new build.

## Building staging and production from one codebase

Hard-coding `"production"` in `app.json` means you'd have to edit the file to build for staging. Instead, read the channel from an environment variable in `app.config.ts`. Tidepush uses the variable **`TIDEPUSH_CHANNEL`**.

### `app.config.ts`

```ts
import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Picks the OTA channel baked into a build. app.json defaults to "production".
 * Build a staging binary with: TIDEPUSH_CHANNEL=staging npx expo prebuild --clean
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const channel = process.env.TIDEPUSH_CHANNEL ?? "production";
  return {
    ...config,
    updates: {
      ...config.updates,
      requestHeaders: { ...config.updates?.requestHeaders, "expo-channel-name": channel },
    },
  } as ExpoConfig;
};
```

`app.config.ts` receives everything from `app.json` as `config`, so you keep the rest of your settings in `app.json`.

### The problem this creates, and `fingerprint.config.js`

With the `fingerprint` runtime policy, the runtime version is a hash of everything that could affect native code, **including the app config**. The channel header is part of the app config. So, without a fix, a staging build and a production build of the same code get **different runtime versions**, and an update published for one can never be used by the other. Promoting would be impossible.

The fix is to tell the fingerprint to ignore `updates.requestHeaders`. The channel header doesn't change native code, so ignoring it is safe. Create `fingerprint.config.js` in your app's root:

```js
/**
 * The channel header is set per build (see app.config.ts) and doesn't
 * affect native code, so keep it out of the runtime fingerprint.
 * @type {import('expo/fingerprint').Config}
 */
const config = {
  fileHookTransform: (source, chunk) => {
    if (source.type !== "contents" || source.id !== "expoConfig" || typeof chunk !== "string") {
      return chunk;
    }
    const expoConfig = JSON.parse(chunk);
    if (expoConfig.updates) delete expoConfig.updates.requestHeaders;
    return JSON.stringify(expoConfig);
  },
};

module.exports = config;
```

Now staging and production builds of the same native code share one runtime version.

### Check it

```sh
cd ~/my-app
npx expo-updates runtimeversion:resolve --platform android
TIDEPUSH_CHANNEL=staging npx expo-updates runtimeversion:resolve --platform android
```

Both commands must print the **same** `runtimeVersion`.

### Building each flavour

```sh
# production build
npx expo prebuild --clean && npx expo run:android --variant release

# staging build
TIDEPUSH_CHANNEL=staging npx expo prebuild --clean && npx expo run:android --variant release
```

::: tip Why the CLI sets TIDEPUSH_CHANNEL too
`tidepush publish --channel staging` runs `expo export`, `expo config` and `runtimeversion:resolve` with `TIDEPUSH_CHANNEL=staging`. Your `app.config.ts` therefore sees the same channel during publishing as during the build, and the stored app config matches.
:::

## Publishing to a channel

```sh
bun run tidepush publish --channel staging -m "New onboarding copy"
```

## Promoting staging → production

When the staging update has been tested, copy it to production:

```sh
bun run tidepush promote <groupId> --to production
```

```text
✔ Promoted 7c1e0b52-… to production (group 2d9f4c11-…)
  android  8a1b…
  ios      c03e…
```

**What promote does:**

- It copies each **active** update in the group to the target channel. The files, runtime version and app config are exactly the same. Nothing is rebuilt or re-exported.
- The copies get **new ids** and the **current time**, so they count as newer than anything already on production.
- The copy keeps the original message unless you change it via the API. It remembers where it came from (`sourceUpdateId`).
- It's recorded in the audit log.

You can promote to a partial rollout straight away:

```sh
bun run tidepush promote <groupId> --to production --rollout 10
```

You can also promote from the dashboard's Updates page.

::: warning Promote needs matching runtimes
Production phones only accept the promoted update if their runtime version matches. That's why the `fingerprint.config.js` above matters. Promoting to a channel where no build has that runtime is allowed but reaches nobody.
:::
