import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { FREE_PLAN, assertCanPublish, currentMonth } from "../src/billing";
import { render, sendEmail } from "../src/email";
import app from "../src/index";
import { ORIGIN, PASSWORD, cookieFrom, createAdmin } from "./helpers";

type Sent = { from: unknown; to: unknown; subject: string; text: string; html: string };

/** Email configured, with a fake binding that records what would be sent. */
function withEmail(extra: Record<string, string> = {}) {
  const sent: Sent[] = [];
  const EMAIL = { send: async (m: Sent) => (sent.push(m), { messageId: `m-${sent.length}` }) };
  return { sent, env: { ...env, EMAIL, EMAIL_FROM: "Tidepush <no-reply@tidepush.test>", WEB_URL: "https://app.tidepush.test", ...extra } };
}

describe("email", () => {
  it("isn't sent when EMAIL_FROM is empty", async () => {
    const { sent, env: e } = withEmail({ EMAIL_FROM: "" });
    expect(await sendEmail(e, { to: "a@example.com", subject: "x", lines: ["y"] })).toBe(false);
    expect(sent).toEqual([]);
  });

  it("renders text and escaped HTML with the action link", () => {
    const { text, html } = render({ to: "x", subject: "s", lines: ["Hi <b>you</b>"], action: { label: "Go", url: "https://x.test/?a=1&b=2" } });
    expect(text).toContain("Go: https://x.test/?a=1&b=2");
    expect(html).toContain("Hi &lt;b&gt;you&lt;/b&gt;");
    expect(html).toContain('href="https://x.test/?a=1&amp;b=2"');
  });

  it("sends invites with a link to the web app", async () => {
    const { sent, env: e } = withEmail();
    const owner = await createAdmin({ role: "owner", name: "Ada" });
    const ctx = createExecutionContext();
    const login = await app.fetch(
      new Request(`${ORIGIN}/auth/login`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: owner.email, password: PASSWORD }),
      }),
      e,
      ctx,
    );
    const res = await app.fetch(
      new Request(`${ORIGIN}/admin/orgs/org_default/members/invites`, {
        method: "POST",
        headers: { origin: ORIGIN, cookie: cookieFrom(login), "content-type": "application/json" },
        body: JSON.stringify({ email: `invitee-${crypto.randomUUID().slice(0, 6)}@example.com`, role: "member" }),
      }),
      e,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const body = (await res.json()) as { inviteUrl: string; emailed: boolean };
    expect(body.emailed).toBe(true);
    expect(body.inviteUrl).toMatch(/^https:\/\/app\.tidepush\.test\/invite\//);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.from).toEqual({ name: "Tidepush", email: "no-reply@tidepush.test" });
    expect(sent[0]!.subject).toBe("You're invited to Default on Tidepush");
    expect(sent[0]!.text).toContain(body.inviteUrl);
    expect(sent[0]!.text).toContain("Ada invited you");
  });

  it("warns owners once when an org goes over the free plan", async () => {
    const { sent, env: e } = withEmail({ TIDEPUSH_MODE: "hosted" });
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const orgId = `org_${suffix}`;
    const appId = `app_${suffix}`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, 'Acme', ?)`).bind(orgId, `o-${suffix}`, new Date().toISOString()),
      env.DB.prepare(`INSERT INTO apps (id, org_id, name, created_at) VALUES (?, ?, 'App', ?)`).bind(appId, orgId, new Date().toISOString()),
    ]);
    const owner = await createAdmin({ role: "owner", orgId });
    await createAdmin({ role: "member", orgId });
    const rows = Array.from({ length: FREE_PLAN.monthlyActiveDevices + 1 }, (_, i) =>
      env.DB.prepare(`INSERT INTO device_months (app_id, month, client_id) VALUES (?, ?, ?)`).bind(appId, currentMonth(), `c${i}`),
    );
    for (let i = 0; i < rows.length; i += 500) await env.DB.batch(rows.slice(i, i + 500));

    await assertCanPublish(e, orgId);
    await assertCanPublish(e, orgId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([owner.email]);
    expect(sent[0]!.subject).toBe("Acme is over the free plan's limits");
    expect(sent[0]!.text).toContain(`https://app.tidepush.test/${orgId}/settings#billing`);
  });
});
