/**
 * Transactional email through Cloudflare Email Service (the `send_email`
 * binding). Used by both Workers: the API (invites, plan warnings) and the
 * web app (password resets).
 *
 * Sending is on only when EMAIL_FROM is set to an address on a domain
 * onboarded to Email Service. Otherwise nothing is sent and the caller falls
 * back to showing the link (self-hosted deployments, local development).
 */

/** The subset of the `send_email` binding this module uses. */
export interface EmailBinding {
  send(message: { from: string | { email: string; name: string }; to: string | string[]; subject: string; text: string; html: string }): Promise<{ messageId: string }>;
}

export interface EmailEnv {
  EMAIL?: EmailBinding;
  /** e.g. "Tidepush <no-reply@tidepush.dev>". Empty = don't send. */
  EMAIL_FROM?: string;
}

export interface Email {
  to: string | string[];
  subject: string;
  /** Plain paragraphs; the first link-like line becomes a button in HTML. */
  lines: string[];
  action?: { label: string; url: string };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function parseFrom(from: string): string | { email: string; name: string } {
  const m = from.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1]!, email: m[2]! } : from.trim();
}

export function render(email: Email): { text: string; html: string } {
  const text = [...email.lines, ...(email.action ? [`${email.action.label}: ${email.action.url}`] : [])].join("\n\n");
  const button = email.action
    ? `<p><a href="${escapeHtml(email.action.url)}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#18d26e;color:#0b1a12;font-weight:600;text-decoration:none">${escapeHtml(email.action.label)}</a></p>
<p style="color:#6b7280;font-size:13px">Or paste this link into your browser: ${escapeHtml(email.action.url)}</p>`
    : "";
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#10263e;line-height:1.5;max-width:520px">
${email.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
${button}
<p style="color:#6b7280;font-size:13px">Tidepush</p>
</body></html>`;
  return { text, html };
}

/** Sends `email` if sending is configured. Returns whether it was sent; never throws. */
export async function sendEmail(env: EmailEnv, email: Email): Promise<boolean> {
  if (!env.EMAIL || !env.EMAIL_FROM) {
    console.log(`[email not configured] to=${String(email.to)} subject=${email.subject} ${email.action?.url ?? ""}`);
    return false;
  }
  try {
    await env.EMAIL.send({ from: parseFrom(env.EMAIL_FROM), to: email.to, subject: email.subject, ...render(email) });
    return true;
  } catch (e) {
    console.error("email send failed", (e as { code?: string }).code ?? "", e);
    return false;
  }
}
