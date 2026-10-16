# Plans & limits

## Plan limits

Each organization is on a plan. A plan sets how many of these you can have:

| Limit | What counts |
| --- | --- |
| **Monthly active devices** | Across all the organization's apps. See below. |
| **Apps** | Apps that aren't archived |
| **Members** | People in the organization, including pending invites |

| | Free | Subscribed |
| --- | --- | --- |
| Monthly active devices | 1,000 | No limit |
| Apps | 1 | No limit |
| Members | 3 | No limit |

Your plan, its limits and this month's usage are in **Settings → Billing**. Online payments are coming; until then, owners can email us to subscribe.

### Monthly active devices

A device is one install of your app, identified by the random client id that `expo-updates` creates (`eas-client-id`). It counts as **active** for an app in a month if it checked for an update at least once during that calendar month (UTC).

- The same install counts once per month, however often it checks.
- Reinstalling the app creates a new client id, so it counts as a new device.
- Builds without `expo-updates` enabled, and debug builds, never check, so they never count.

### Going over a limit

**Phones always keep getting updates.** Going over a limit never changes what your users receive.

1. The dashboard shows a warning, and owners get an email.
2. After **7 days** over the limit, **publishing** is paused: `publish` and `promote` fail with `402`. Rollouts and rollbacks keep working, so you can always fix a bad update.
3. Publishing resumes as soon as you upgrade, or when usage is back under the limit (for devices, at the start of the next month).

The app and member limits apply when you add more: creating another app or inviting another person fails with `402` on the free plan. Archived apps don't count, and phones keep getting their updates.

## Limits on every plan

| Limit | Value |
| --- | --- |
| Single file in an update | 95 MB |
| Files per platform in one publish | 5,000 |
| Updates considered per update check | The newest 200 in the device's channel + platform + runtime version |
| Update message | Up to 1,000 characters |
| Rollout percentage | Whole number, 0–100 |
| Channel name | Letters, digits, `.`, `_` and `-`; up to 64 characters; must start with a letter or digit |

A JavaScript bundle over 95 MB can't be published. If you get close, look for large images or fonts imported from JavaScript.

## Storage

Each publish stores only files that changed since earlier updates of the same app. A Hermes bundle is usually 5–10 MB per platform. Promotions and rollbacks never copy files.
