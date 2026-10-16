# Self-hosting

Tidepush is open source under the **AGPL-3.0**. The hosted service at [tidepush-web.yugenecodes99.workers.dev](https://tidepush-web.yugenecodes99.workers.dev) runs the same code.

Most teams are best served by the hosted service: there's nothing to deploy, patch, monitor or back up. Some teams have to run it themselves, for example regulated apps that must keep signing keys and release data on their own infrastructure. They can.

## Where to start

This site documents the hosted service. Self-hosting instructions ship with the source code, in the [GitHub repository](https://github.com/Yug3ne/tidepush).

A self-hosted Tidepush works with the same `expo-updates` setup, the same CLI and the same dashboard. Your apps use your own server's address in `updates.url` instead of `tidepush.yugenecodes99.workers.dev`.

## Moving between hosted and self-hosted

`updates.url` and the certificate are built into each binary. Builds already on phones keep asking the address they were built with. So moving in either direction means:

1. **Keep the same key.** An owner exports the app's private key from **Settings → Code signing** (hosted), or uploads your existing key when creating the app (hosted). The certificate in your app then stays valid.
2. **Ship a new store build** that points `updates.url` at the new address.
3. **Publish to both places** until most users have the new build. The dashboard's Devices page shows how many devices are on each.

## Licensing

Running Tidepush yourself, unmodified, for your own apps has no conditions beyond the AGPL's notices. If you modify it and let others use it over a network, or offer it as a service, the AGPL requires you to share your changes. Commercial licenses without these conditions are available. See [License](/license).
