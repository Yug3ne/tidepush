# Protocol details

Tidepush implements the server side of the [Expo Updates protocol, version 1](https://docs.expo.dev/technical-specs/expo-updates-1/). This page lists exactly what it reads and returns.

All protocol URLs are under your app's base address, `https://u.tidepush.dev/<appId>`. An unknown app id → `404`.

## `GET /<appId>/manifest`

### Request: what Tidepush reads

Each value is read from the header, or from the query parameter in brackets if the header is missing (handy for testing with a browser or `curl`).

| Header | Required | Use |
| --- | --- | --- |
| `expo-platform` (`?platform=`) | Yes | `ios` or `android`. Anything else → `400`. |
| `expo-runtime-version` (`?runtime-version=`) | Yes | Must exactly match an update's runtime version. |
| `expo-channel-name` (`?channel=`) | Yes | Channel to look in. |
| `expo-protocol-version` | No | `1` enables directives. Missing or `0` → no directives (`204` instead). |
| `expo-current-update-id` | No | What the device runs now. Used to answer `noUpdateAvailable` and to decide on `rollBackToEmbedded`. Recorded for stats. |
| `expo-embedded-update-id` | No | The id of the bundle built into the app. Recorded for stats; used to tell "running embedded" apart. |
| `eas-client-id` | No | Stable per-install id. Needed for partial rollouts and device stats. |
| `expo-expect-signature` | No | If present, every manifest/directive is signed. |
| `accept` | No | Multipart is used if it's missing or includes `multipart/mixed` or `*/*`. Otherwise a plain `application/expo+json` manifest. |

Missing platform, runtime version or channel: `400 { "error": "…" }`.

### Response headers (always)

```http
expo-protocol-version: 1
expo-sfv-version: 0
cache-control: private, max-age=0
```

### Response: an update (multipart)

```http
HTTP/1.1 200 OK
content-type: multipart/mixed; boundary=expo-<uuid>

--expo-<uuid>
content-disposition: form-data; name="manifest"
content-type: application/json; charset=utf-8
expo-signature: sig="<base64>", keyid="main"

{"id":"…","createdAt":"…","runtimeVersion":"…","launchAsset":{…},"assets":[…],"metadata":{},"extra":{"expoClient":{…}}}
--expo-<uuid>
content-disposition: form-data; name="extensions"
content-type: application/json; charset=utf-8

{"assetRequestHeaders":{}}
--expo-<uuid>--
```

The `expo-signature` part header is present only when the client sent `expo-expect-signature`.

### The manifest

```json
{
  "id": "4f2a8e77-91c3-4b8a-a1d0-6e2b9c7f3a10",
  "createdAt": "2026-10-15T09:30:00.000Z",
  "runtimeVersion": "3f9c1a7e…",
  "launchAsset": {
    "hash": "<base64url sha256>",
    "key": "<hex sha256>",
    "contentType": "application/javascript",
    "fileExtension": ".bundle",
    "url": "https://u.tidepush.dev/<appId>/assets/<hex sha256>"
  },
  "assets": [
    { "hash": "…", "key": "…", "contentType": "image/png", "fileExtension": ".png", "url": "…" }
  ],
  "metadata": {},
  "extra": { "expoClient": { "name": "My App", "…": "…" } }
}
```

- `key` is the hex SHA-256 of the file; `hash` is the same digest in base64url, which `expo-updates` verifies after download.
- `extra.expoClient` is the public app config captured at publish time. `expo-constants` exposes it in the running app.

### Response: a non-multipart manifest

If the client doesn't accept multipart, the body is the manifest JSON with `content-type: application/expo+json` and, if requested, an `expo-signature` response header.

### Response: directives

Directives are only sent to protocol-1 clients that accept multipart. Otherwise Tidepush answers `204 No Content` (no update).

```http
--expo-<uuid>
content-disposition: form-data; name="directive"
content-type: application/json; charset=utf-8
expo-signature: sig="<base64>", keyid="main"

{"type":"noUpdateAvailable"}
--expo-<uuid>--
```

```json
{ "type": "rollBackToEmbedded", "parameters": { "commitTime": "2026-10-15T10:02:11.000Z" } }
```

`commitTime` is the time of the most recent rollback in that line. The client only acts on it if it's newer than the update it's running.

### Signatures

- Algorithm: RSASSA-PKCS1-v1_5 with SHA-256 (`rsa-v1_5-sha256`).
- Signed bytes: the exact UTF-8 body of the part (manifest or directive JSON).
- Header format (structured field dictionary): `sig="<base64 signature>", keyid="<key id>"`. The key id is the one the app asked for in `expo-expect-signature`, default `main`. It must be one of the app's keys in **Settings → Code signing**.
- Every response to a client that expects a signature is signed. Tidepush never falls back to an unsigned response.

### Side effect: device record

When `eas-client-id` is present, Tidepush records the device (client id, platform, runtime, channel, current and embedded update ids, last seen) after responding. This feeds the dashboard's adoption numbers and your monthly active device count. It never slows down or affects the response.

## Assets

### `GET /<appId>/assets/:key`

- `:key` must be 64 lowercase hex characters; anything else → `404`.
- Served from a global CDN with the stored `content-type` and an `etag`.
- `cache-control: public, max-age=31536000, immutable`.
- Missing → `404`.

Files are immutable: a key is the hash of the content, so the same key always means the same bytes.

## Selection algorithm

See [How it works → How the server picks an update](/guide/how-it-works#how-the-server-picks-an-update). In short: newest active update in the device's channel + platform + runtime that the device is bucketed into; `noUpdateAvailable` if it's already running it; `rollBackToEmbedded` if nothing is active, something was rolled back, and the device isn't on its embedded bundle.

Bucket: `uint32(first 4 bytes of SHA-256("<eas-client-id>:<update id>")) mod 100 < rollout percentage`. Requests without a client id only match updates at 100%.
