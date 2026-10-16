// Debug helper: prints browser console output, page errors and failed requests for one URL.
// Usage: node e2e/console.mjs [url]
import { chromium } from "playwright-core";
const url = process.argv[2] ?? "http://localhost:3000/signup";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium" });
const p = await b.newPage();
p.on("console", (m) => console.log("console", m.type(), m.text().slice(0, 300)));
p.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 500)));
p.on("requestfailed", (r) => console.log("failed", r.url(), r.failure()?.errorText));
p.on("response", (r) => r.status() >= 400 && console.log("http", r.status(), r.url()));
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
await b.close();
