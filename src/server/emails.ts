import "server-only";
import type { Mail } from "./mail";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", staff: "Staff", viewer: "Viewer" };

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** One plain, readable layout for every notification: a heading, a few lines, one button. */
function layout({
  heading,
  lines,
  action,
  footnote,
}: {
  heading: string;
  lines: string[];
  action: { label: string; url: string };
  footnote: string;
}) {
  const body = lines
    .map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:22px;color:#3f3f46">${l}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
<tr><td style="padding:28px 28px 8px"><p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#18181b">EveryOps</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;color:#18181b">${heading}</h1>${body}</td></tr>
<tr><td style="padding:8px 28px 24px"><a href="${esc(action.url)}" style="display:inline-block;background:#3FA796;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${esc(action.label)}</a>
<p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#71717a">Or open this link: <a href="${esc(action.url)}" style="color:#3FA796;word-break:break-all">${esc(action.url)}</a></p></td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e4e4e7;font-size:12px;line-height:18px;color:#71717a">${footnote}</td></tr>
</table></td></tr></table></body></html>`;
}

export function inviteEmail(p: {
  to: string;
  workspaceName: string;
  invitedBy: string;
  role: string;
  url: string;
}): Mail {
  const role = ROLE_LABEL[p.role] ?? p.role;
  const subject = `${p.invitedBy} invited you to ${p.workspaceName} on EveryOps`;
  const text = [
    `${p.invitedBy} invited you to join ${p.workspaceName} on EveryOps as ${role}.`,
    "",
    `Accept the invite: ${p.url}`,
    "",
    `Sign in or create an account with ${p.to} to join. If you weren't expecting this, you can ignore this email.`,
  ].join("\n");
  const html = layout({
    heading: `Join ${esc(p.workspaceName)}`,
    lines: [
      `<strong>${esc(p.invitedBy)}</strong> invited you to join <strong>${esc(p.workspaceName)}</strong> on EveryOps as <strong>${esc(role)}</strong>.`,
      `Sign in or create an account with <strong>${esc(p.to)}</strong> to join.`,
    ],
    action: { label: "Accept invite", url: p.url },
    footnote: "If you weren't expecting this invite, you can ignore this email.",
  });
  return { to: p.to, subject, text, html };
}

export function resetPasswordEmail(p: { to: string; name: string; url: string }): Mail {
  const subject = "Reset your EveryOps password";
  const text = [
    `Hi ${p.name},`,
    "",
    `Reset your password here: ${p.url}`,
    "",
    "The link works once and expires in 30 minutes. If you didn't ask for this, you can ignore this email.",
  ].join("\n");
  const html = layout({
    heading: "Reset your password",
    lines: [
      `Hi ${esc(p.name)}, use the button below to choose a new password.`,
      "The link works once and expires in 30 minutes.",
    ],
    action: { label: "Reset password", url: p.url },
    footnote:
      "If you didn't ask to reset your password, you can ignore this email. Your password won't change.",
  });
  return { to: p.to, subject, text, html };
}
