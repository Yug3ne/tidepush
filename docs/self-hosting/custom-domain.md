# Custom domain

By default your two Workers live at `https://tidepush.<your-subdomain>.workers.dev` (the API, which phones use) and `https://tidepush-web.<your-subdomain>.workers.dev` (the dashboard). For a real app you want your own address for the API, such as `https://ota.example.com`, and usually one for the dashboard too, such as `https://ota-admin.example.com`.

::: danger Decide before your first store release
`updates.url` is **built into the app**. If you change the API's address later, existing installs keep asking the old one until users install a new build. So set up the custom domain **before** you ship a store build, and keep the old address working for as long as old builds are in use. The dashboard's address isn't built into anything, so you can change it any time.
:::

## Requirements

- The domain must be on Cloudflare (added as a zone in your account, with Cloudflare nameservers).

## Add the domain to the API Worker

Edit `apps/server/wrangler.jsonc` and add a `routes` block (there's a commented example in the file):

```jsonc
"routes": [
  { "pattern": "ota.example.com", "custom_domain": true }
]
```

`custom_domain: true` makes Cloudflare create the DNS record and TLS certificate for you. Then deploy:

```sh
cd ~/tidepush
bun run deploy
```

Check it:

```sh
curl https://ota.example.com/health
# {"ok":true}
```

You can do the same in the Cloudflare dashboard instead: **Workers & Pages → tidepush → Settings → Domains & Routes → Add → Custom domain**. If you do it there, don't also add it in `wrangler.jsonc` with different values, or the next deploy may change it.

::: tip Keep your fork's wrangler.jsonc private
`wrangler.jsonc` in the public Tidepush repository has no domains or account ids on purpose. Put your `routes` in your own fork or deployment branch.
:::

## Update the app

```json
"updates": {
  "url": "https://ota.example.com/manifest"
}
```

Then make a new build. Update the CLI too:

```sh
# ~/tidepush/.env
TIDEPUSH_SERVER_URL=https://ota.example.com
```

And tell the web app, so the dashboard shows the right `updates.url`: set `UPDATES_URL` in `apps/web/wrangler.jsonc` to `https://ota.example.com` and run `bun run deploy`.

## Should I keep workers.dev on?

The API Worker stays reachable at its workers.dev address unless you set `"workers_dev": false` in `apps/server/wrangler.jsonc`. Keep it on while any installed build still points at it. Once no build uses it, turn it off so there is only one way in. The web app's workers.dev address can go as soon as its own domain works (`"workers_dev": false` in `apps/web/wrangler.jsonc`).

## A domain for the dashboard

The dashboard is the web app, a separate Worker, so it gets its own hostname. In `apps/web/wrangler.jsonc` add:

```jsonc
"routes": [
  { "pattern": "ota-admin.example.com", "custom_domain": true }
]
```

Then update the addresses that point at it, and deploy both Workers:

| Where | Set |
| --- | --- |
| `apps/web/wrangler.jsonc` → `BETTER_AUTH_URL` | `https://ota-admin.example.com` |
| `apps/server/wrangler.jsonc` → `WEB_URL` | `https://ota-admin.example.com` |
| GitHub OAuth app (if you use GitHub sign-in) | Callback URL `https://ota-admin.example.com/api/auth/callback/github` |

```sh
cd ~/tidepush
bun run deploy
```

Everyone signs in again at the new address. Sessions are tied to the hostname, so the old address's sessions don't carry over. If people use `tidepush login`, they run it again with `--web https://ota-admin.example.com`.

To put your company's single sign-on in front of the dashboard, add a Cloudflare Access application for this hostname. See [Cloudflare Access](./admin-accounts.md#optional-cloudflare-access).
