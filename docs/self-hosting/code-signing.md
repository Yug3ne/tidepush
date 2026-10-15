# Code signing & keys

Code signing makes sure your users only run updates that **you** published.

## What it protects against

Without signing, anyone who could change what your update server returns (a compromised account, a misconfigured proxy, a DNS hijack) could make every phone run their JavaScript, inside your app, with your app's permissions. For a finance app that is the worst-case scenario.

With signing:

1. Tidepush signs every **manifest** and every **directive** with your **private key** (RSA with SHA-256).
2. The app contains your **certificate**, built in at build time.
3. The app checks the signature before using anything. Unsigned or changed responses are rejected, and the app keeps running what it has.

The manifest lists the SHA-256 hash of every file, so signing the manifest also protects the bundle and images: the app checks each downloaded file against its hash.

## Generating keys

```sh
cd ~/my-app
npx expo-updates codesigning:generate \
  --key-output-directory ~/tidepush/.secrets/codesigning-keys \
  --certificate-output-directory certs \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "My App"
```

| File | Goes where |
| --- | --- |
| `certs/certificate.pem` | Committed in your app repo, referenced by `updates.codeSigningCertificate` |
| `private-key.pem` | Worker secret `CODE_SIGNING_PRIVATE_KEY`, plus a copy in your password manager. Never in Git. |
| `public-key.pem` | Not used by Tidepush. Keep it with the private key. |

The `.secrets/` folder in the Tidepush repo is gitignored, which is why the tutorial puts keys there. After uploading the secret and saving a copy in your password manager, you can delete the local file. Keep it only if you use [local development](/guides/local-development) with real signing.

## App configuration

```json
"updates": {
  "codeSigningCertificate": "./certs/certificate.pem",
  "codeSigningMetadata": { "keyid": "main", "alg": "rsa-v1_5-sha256" }
}
```

You can also let Expo write this for you:

```sh
npx expo-updates codesigning:configure \
  --certificate-input-directory certs \
  --key-input-directory ~/tidepush/.secrets/codesigning-keys
```

## Server configuration

| Setting | Type | Value |
| --- | --- | --- |
| `CODE_SIGNING_PRIVATE_KEY` | Secret | The PEM file. Both `BEGIN RSA PRIVATE KEY` (PKCS#1, what Expo generates) and `BEGIN PRIVATE KEY` (PKCS#8) work. |
| `CODE_SIGNING_KEY_ID` | Var in `wrangler.jsonc` | Must equal `codeSigningMetadata.keyid` in the app. Default `main`. |

```sh
cd ~/tidepush/apps/server
npx wrangler secret put CODE_SIGNING_PRIVATE_KEY < ../../.secrets/codesigning-keys/private-key.pem
```

The server signs only when the app asks for it (the app sends `expo-expect-signature` when it has a certificate). If the app asks and the secret is missing, the server returns an error rather than an unsigned response.

## Rotating or losing the key

The certificate is **built into the app**. That has big consequences:

- **A new key only works for builds made with the new certificate.** Existing installs only trust the old certificate.
- If you switch the server to a new key, **every existing build rejects every update** until users install a new store build.
- If you **lose** the private key, you can't sign updates for existing builds anymore. You'll need a new key, a new certificate and a new store build.
- If the private key **leaks**, an attacker who can also control your server's responses could sign updates. Rotate: make a new key pair, ship a store build with the new certificate, switch the server secret, and push users to update.

::: warning One key at a time
Tidepush signs with one key. During a rotation, the old builds and the new builds can't both receive signed updates from the same server. Plan rotations around a forced store update, or run a second Tidepush Worker for the new builds.
:::

The generated certificate is valid for 10 years with the command above. Expo checks the certificate's validity, so pick a long validity.

## Testing that signing works

See the tamper check in [Testing on a device](/guides/testing-on-device#tamper-check): sign with a different key and confirm the app refuses the update.
