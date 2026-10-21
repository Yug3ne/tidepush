---
title: "License"
---

Tidepush is **dual-licensed**:

1. **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`), free for everyone. The full text is in the [`LICENSE`](https://github.com/Yug3ne/tidepush/blob/main/LICENSE) file.
2. **A commercial license**, for organisations that can't or don't want to meet the AGPL's conditions. See [`COMMERCIAL-LICENSE.md`](https://github.com/Yug3ne/tidepush/blob/main/COMMERCIAL-LICENSE.md).

Copyright © Eugene Koech.

:::note[Not legal advice]
This page explains the license in plain words to help you decide. The license text is what counts. If you're unsure, ask a lawyer.
:::

## The AGPL in plain words

The AGPL is a "copyleft" license. You may use, copy, change and share Tidepush freely. In return, if you **share** it, or **let other people use a changed version over a network**, you must give them the source code of your version under the same license.

What that means for you depends on what you do:

| You… | Do you need to do anything? |
| --- | --- |
| **Use** Tidepush to ship updates to your own apps, unmodified | **No.** Deploy it and use it. Your **mobile app is not affected**: the app only talks to Tidepush over the Expo Updates protocol; it doesn't include Tidepush code. |
| **Use the hosted Tidepush service** | **No.** The AGPL applies to the Tidepush software, not to your app or to your use of the service. |
| **Self-host** it for your company, with your own configuration | **No.** Configuration isn't a modification of the program. |
| **Modify** it and use it only inside your organisation | **Usually no.** The AGPL's sharing duty is triggered by distributing it, or by letting people outside your organisation interact with your modified version over a network. Your own employees using the dashboard is generally treated as internal use. |
| **Modify** it and let others interact with it over a network (e.g. clients use your dashboard or API) | **Yes.** Offer those users the complete source of your modified version, under the AGPL. A link to a public repository is the usual way. |
| **Offer Tidepush as a hosted service** (an OTA platform for other companies), modified or not | **Yes.** Your users must be able to get the full source of what you run, including your changes, under the AGPL. If you don't want to publish your changes, you need a **commercial license**. |
| **Distribute** it (give copies to others, ship it inside a product) | **Yes.** Include the license and the source, and keep it under the AGPL. Embedding it in a proprietary product needs a **commercial license**. |

In every case: keep the copyright and license notices, and don't add restrictions on top of the AGPL for the people you share it with.

## Commercial license

A commercial license lets you use, modify and embed Tidepush **without** the AGPL's conditions. Typical reasons:

- running a closed-source hosted OTA service built on Tidepush,
- shipping Tidepush inside a proprietary product,
- a company policy that doesn't allow AGPL software.

To ask about a commercial license, contact the copyright holder, Eugene Koech: [yugenecodes99@gmail.com](mailto:yugenecodes99@gmail.com)



## Contributions

Contributors agree that their contributions may be distributed under both the AGPL and commercial licenses (a contributor license agreement in [`CONTRIBUTING.md`](https://github.com/Yug3ne/tidepush/blob/main/CONTRIBUTING.md)). Contributors keep the copyright to their work. This is what keeps dual licensing possible. See [Contributing](/contributing).

## Third-party software

Tidepush depends on open-source packages (Hono, Zod, React, Astro and others) under their own licenses, mostly MIT. Expo and `expo-updates` are separate projects under their own licenses.
