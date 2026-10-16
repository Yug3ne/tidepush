# Code signing & keys

Code signing makes sure your users only run updates that **you** published. It's on for every app by default.

## What it protects against

Without signing, anyone who could change what the update server returns (a compromised account, a misconfigured proxy, a DNS hijack) could make every phone run their JavaScript, inside your app, with your app's permissions. For a finance app that is the worst-case scenario.

With signing:

1. Tidepush signs every **manifest** and every **directive** with your app's **private key** (RSA with SHA-256).
2. The app contains the matching **certificate**, built in at build time.
3. The app checks the signature before using anything. Unsigned or changed responses are rejected, and the app keeps running what it has.

The manifest lists the SHA-256 hash of every file, so signing the manifest also protects the bundle and images: the app checks each downloaded file against its hash.

## Keys are created with the app

When you create an app, Tidepush generates a key pair for it:

| Part | Where it lives |
| --- | --- |
| Private key | Stored encrypted by Tidepush. Used only to sign that app's responses. |
| Certificate | Built into your app. You download it and commit it to your app repository. |

The key id is `main`. Each app has its own keys, so a key for one app can never sign updates for another.

## Getting the certificate

The easiest way is `init`, run from your Expo app directory:

```sh
npx tidepush init
```

It saves `certs/certificate.pem` and writes the code signing settings into `app.json`.

You can also download it from the dashboard: open the app, then **Settings → Code signing → Download certificate**. Save it as `certs/certificate.pem` in your app repository.

The certificate is public. Commit it.

## App configuration

```json
"updates": {
  "url": "https://tidepush.yugenecodes99.workers.dev/app_7f3k2m9q/manifest",
  "codeSigningCertificate": "./certs/certificate.pem",
  "codeSigningMetadata": { "keyid": "main", "alg": "rsa-v1_5-sha256" }
}
```

`keyid` must match the key id shown in **Settings → Code signing**. When the app has a certificate, it sends `expo-expect-signature` on every update check, and Tidepush signs the response with the key it asked for.

::: warning The certificate is built into the app
Changing `codeSigningCertificate` only affects builds made after the change. Installed builds keep trusting the certificate they were built with.
:::

## Bringing your own key

Owners can upload their own key instead of using the generated one. Generate it with Expo's tool:

```sh
npx expo-updates codesigning:generate \
  --key-output-directory ~/keys/my-app \
  --certificate-output-directory certs \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "My App"
```

| File | Goes where |
| --- | --- |
| `certs/certificate.pem` | Committed in your app repo, referenced by `updates.codeSigningCertificate` |
| `private-key.pem` | Uploaded in **Settings → Code signing → Upload key**, plus a copy in your password manager. Never in Git. |
| `public-key.pem` | Not used by Tidepush. Keep it with the private key. |

Both `BEGIN RSA PRIVATE KEY` (PKCS#1, what Expo generates) and `BEGIN PRIVATE KEY` (PKCS#8) work. Uploading a key is recorded in the audit log.

Expo checks the certificate's validity dates, so pick a long validity. Generated keys use 10 years.

## Exporting the private key

Owners can download an app's private key from **Settings → Code signing → Export private key**. You'll be asked to sign in again first, and the export is recorded in the audit log.

Export it if you want your own backup, or if you plan to [run Tidepush yourself](/self-hosting) later: builds in the field only trust that key, so you need it to keep updating them.

::: danger Treat an exported key like a password
Anyone with the private key, who can also control what your app downloads, can sign updates your users will run. Store it in a password manager or secrets vault, never in Git or chat.
:::

## Rotating keys

An app can have more than one key, each with its own key id. Every build tells Tidepush which key id it trusts (`codeSigningMetadata.keyid`), and Tidepush signs with that key. So old and new builds both keep working during a switch.

1. In **Settings → Code signing**, add a key with a new key id, for example `2026-10`. Tidepush generates it, or you upload your own.
2. Download its certificate and update `app.json`: the new `codeSigningCertificate` and `"keyid": "2026-10"`.
3. Ship a new store build. Old builds keep using `main`, new builds use `2026-10`.
4. Once few enough users are left on the old builds, retire the old key.

::: warning Retiring a key cuts off old builds
Builds that trust a retired key reject every update after that. Retire it only when you're happy for those builds to stay on what they have until users install a newer build.
:::

## Losing or leaking a key

- **Lost:** Tidepush stores every app's private key, generated or uploaded, so losing your local copy doesn't stop updates. Keep the exported or uploaded copy safe anyway if you might [run Tidepush yourself](/self-hosting) one day.
- **Leaked:** an attacker who also controls what your app downloads could sign updates. Add a new key, ship a store build with the new certificate, push users to update, then retire the leaked key.

## Testing that signing works

See the tamper check in [Testing on a device](/guides/testing-on-device): build with a certificate from a different app and confirm the app refuses updates.
