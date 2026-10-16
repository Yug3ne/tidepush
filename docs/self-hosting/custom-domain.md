# Custom domain

By default your server lives at `https://tidepush.<your-subdomain>.workers.dev`. For a real app you want your own address, such as `https://ota.example.com`.

::: danger Decide before your first store release
`updates.url` is **built into the app**. If you change the address later, existing installs keep asking the old one until users install a new build. So set up the custom domain **before** you ship a store build, and keep the old address working for as long as old builds are in use.
:::

## Requirements

- The domain must be on Cloudflare (added as a zone in your account, with Cloudflare nameservers).

## Add the domain

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

## Should I keep workers.dev on?

The Worker stays reachable at its workers.dev address unless you set `"workers_dev": false` in `wrangler.jsonc`. Keep it on while any installed build still points at it. Once no build uses it, turn it off so there is only one way in.

## A separate admin hostname (optional)

Everything (manifest, assets, dashboard, admin API) is served from one hostname, and the admin side has its own login. If you also want [Cloudflare Access](./admin-accounts.md#optional-cloudflare-access) in front of the dashboard, a second hostname helps:

```jsonc
"routes": [
  { "pattern": "ota.example.com", "custom_domain": true },
  { "pattern": "ota-admin.example.com", "custom_domain": true }
]
```

Phones use `ota.example.com`; you protect `ota-admin.example.com` with Access.
