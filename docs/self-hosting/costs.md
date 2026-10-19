# Costs & limits

Tidepush uses three Cloudflare products: two Workers (the API and the web app), D1 and R2. For most apps the total is **$0–5 per month**.

::: info Prices change
The numbers below are a summary to help you estimate. Always check Cloudflare's current pricing: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/).
:::

## What uses what

| Event | Workers requests | D1 | R2 |
| --- | --- | --- | --- |
| App launch (update check) | 1 | ~1 query read + 1 row written (device record) | — |
| Device downloads an update | 1 per file it doesn't have | — | 1 read per file on an edge-cache miss |
| Publish | a few + 1 per new file | a few writes per file | 1 write per new file, storage for new files |
| Dashboard use (web app, which calls the API Worker) | small, on both Workers | small | — |

The biggest numbers are **launches** (Workers requests + D1 writes) and **stored bytes** (R2).

## Workers

| | Free | Paid ($5/month) |
| --- | --- | --- |
| Requests | 100,000 per day, across all your Workers | 10 million per month included, then ~$0.30 per million |
| CPU time | 10 ms per request | 30 s default; 30 million CPU-ms per month included |
| Request body size | 100 MB | 100 MB (more on Enterprise) |

Signing a manifest takes a few milliseconds of CPU, which fits the free plan's limit in practice. Phones only use the API Worker; the web app's requests come from people using the dashboard (and the CLI after `tidepush login`), so they're a small share. The web app's static files are served without running the Worker.

## D1

| | Free | Paid (included in Workers Paid) |
| --- | --- | --- |
| Rows read | 5 million per day | 25 billion per month |
| Rows written | 100,000 per day | 50 million per month |
| Storage | 5 GB total | 5 GB included, then ~$0.75 per GB-month |

Each launch writes one device row, so on the **free** plan you can handle roughly **100,000 app launches per day** before writes run out. Past that, use Workers Paid.

## R2

| | Free each month | Then |
| --- | --- | --- |
| Storage | 10 GB | ~$0.015 per GB-month |
| Class A operations (writes) | 1 million | ~$4.50 per million |
| Class B operations (reads) | 10 million | ~$0.36 per million |
| **Egress (downloads)** | **Free** | **Free** |

No egress fees is the main reason Tidepush is cheap: 100,000 phones downloading an 8 MB bundle (800 GB) costs nothing in bandwidth. Asset responses are also kept in Cloudflare's edge cache, so many downloads never reach R2.

## Sizes

- A Hermes bundle for a medium app is usually **5–10 MB per platform**. Images and fonts add to that, but only changed files are uploaded or stored again.
- Example: 2 platforms × 8 MB × 4 publishes per week ≈ 64 MB/week ≈ 3.3 GB/year. Still inside R2's free 10 GB.
- Promotions and rollbacks copy database rows only; no files are duplicated.

## Limits in Tidepush

| Limit | Value | Why |
| --- | --- | --- |
| Single file upload | **95 MB** | Stays under the Workers request body limit (100 MB on Free/Pro) |
| Files per publish | 5000 per platform | Request size |
| Updates considered per manifest request | newest 200 per channel + platform + runtime | Keeps lookups fast |

A JS bundle over 95 MB can't be published. If you get close, look at large images or fonts bundled into JS.

## Old files

Tidepush doesn't delete old files automatically yet. Storage grows slowly (only changed files). If it ever matters, you can delete R2 objects that no longer belong to any update for a runtime version still in use.

## Compared with hosted services

Hosted update services usually charge per monthly active user or per update download. With Tidepush you pay Cloudflare's usage prices directly, which for most apps fits the free tier or the $5 plan.
