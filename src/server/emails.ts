import "server-only";
import type { Mail } from "./mail";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", staff: "Staff", viewer: "Viewer" };

/** Brand colors from globals.css: primary teal with near-black text, as on the app's buttons. */
const BRAND = {
  primary: "#34c3a6",
  onPrimary: "#03130f",
  ink: "#0f1112",
  text: "#3f4446",
  muted: "#7a8285",
  line: "#e6e9ea",
  page: "#f3f5f5",
};

/** Images in email must be absolute and public, so they always load from the live site. */
const ASSET_BASE = (process.env.EMAIL_ASSET_URL ?? "https://everyops.app").replace(/\/$/, "");

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * One branded layout for every notification: the EveryOps logo, a heading, a few lines, one button.
 * Tables and inline styles only, so it renders the same in Gmail, Outlook and Apple Mail.
 */
function layout({
  heading,
  preview,
  lines,
  action,
  footnote,
}: {
  heading: string;
  preview: string;
  lines: string[];
  action: { label: string; url: string };
  footnote: string;
}) {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const body = lines
    .map((l) => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${BRAND.text}">${l}</p>`)
    .join("");
  const url = esc(action.url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:${font};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page}"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px"><a href="${ASSET_BASE}" style="text-decoration:none"><img src="${ASSET_BASE}/brand/email/everyops-logo.png" width="138" height="28" alt="EveryOps" style="display:block;border:0;height:28px;width:138px"></a></td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="height:4px;background:${BRAND.primary};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 8px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.2px;color:${BRAND.ink}">${heading}</h1>${body}</td></tr>
<tr><td style="padding:8px 32px 32px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${BRAND.primary}">
<a href="${url}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;line-height:20px;color:${BRAND.onPrimary};text-decoration:none;border-radius:8px">${esc(action.label)}</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:${BRAND.muted}">Button not working? Paste this link into your browser:<br><a href="${url}" style="color:${BRAND.ink};word-break:break-all">${url}</a></p>
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid ${BRAND.line};font-size:12px;line-height:18px;color:${BRAND.muted}">${footnote}</td></tr>
</table></td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:18px;color:${BRAND.muted}">
<strong style="color:${BRAND.text}">EveryOps</strong> · Describe your business, and EveryOps builds the systems it needs.<br>
<a href="${ASSET_BASE}" style="color:${BRAND.muted}">everyops.app</a> · Sent from notify@everyops.app
</td></tr>
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
    preview: `${p.invitedBy} invited you to join ${p.workspaceName} as ${role}.`,
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
    preview: "Use this link within 30 minutes to choose a new password.",
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

export function waitlistJoinedEmail(p: {
  to: string;
  name: string | null;
  email: string;
  source: "email" | "google";
  waiting: number;
  approveUrl: string;
  listUrl: string;
}): Mail {
  const who = p.name ? `${p.name} (${p.email})` : p.email;
  const via = p.source === "google" ? "Google" : "email";
  const others = p.waiting > 1 ? `${p.waiting} people are waiting now.` : "They're the only one waiting.";
  const subject = `${p.name ?? p.email} joined the EveryOps waitlist`;
  const text = [
    `${who} tried to create an account with ${via} and is on the waitlist.`,
    others,
    "",
    `Approve them: ${p.approveUrl}`,
    `Everyone waiting: ${p.listUrl}`,
    "",
    "Approving lets them create their account and emails them a sign-up link. The approve link works for 30 days.",
  ].join("\n");
  const html = layout({
    heading: "Someone joined the waitlist",
    preview: `${who} wants an EveryOps account.`,
    lines: [
      `<strong>${esc(p.name ?? p.email)}</strong>${p.name ? ` (${esc(p.email)})` : ""} tried to create an account with ${via} and is on the waitlist.`,
      esc(others),
      "Approving lets them create their account and emails them a sign-up link.",
    ],
    action: { label: `Approve ${p.name ?? p.email}`, url: p.approveUrl },
    footnote: `See everyone waiting on the <a href="${esc(p.listUrl)}" style="color:${BRAND.ink}">waitlist page</a>. The approve link works for 30 days. You get this because you're a site admin of EveryOps.`,
  });
  return { to: p.to, subject, text, html };
}

export function waitlistApprovedEmail(p: { to: string; name: string | null; url: string }): Mail {
  const subject = "Your EveryOps spot is open";
  const hi = p.name ? `Hi ${p.name},` : "Hi,";
  const text = [
    hi,
    "",
    "You're off the waitlist. Create your EveryOps account here:",
    p.url,
    "",
    `Use ${p.to} (or Google with that address) to sign up.`,
  ].join("\n");
  const html = layout({
    heading: "Your spot is open",
    preview: "You're off the EveryOps waitlist. Create your account.",
    lines: [
      p.name ? `Hi ${esc(p.name)}, you're off the waitlist.` : "You're off the waitlist.",
      `Create your account with <strong>${esc(p.to)}</strong>, or continue with Google using that address.`,
    ],
    action: { label: "Create your account", url: p.url },
    footnote: "You get this because you joined the EveryOps waitlist with this address.",
  });
  return { to: p.to, subject, text, html };
}

/** A short note to the site admins (an upgrade asked for, the AI safety switch). */
export function adminNoticeEmail(p: {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  action: { label: string; url: string };
}): Mail {
  return {
    to: p.to,
    subject: p.subject,
    text: [...p.lines, "", `${p.action.label}: ${p.action.url}`].join("\n"),
    html: layout({
      heading: esc(p.heading),
      preview: p.lines[0] ?? p.heading,
      lines: p.lines.map(esc),
      action: p.action,
      footnote: "You get this because you're a site admin of EveryOps.",
    }),
  };
}

/** The link that proves someone owns their email address (needed before AI features). */
export function verifyEmailEmail(p: { to: string; name: string; url: string }): Mail {
  const text = [
    `Hi ${p.name},`,
    "",
    "Confirm this is your email address to start using AI in EveryOps:",
    p.url,
    "",
    "The link works for one hour. If you didn't create an EveryOps account, ignore this email.",
  ].join("\n");
  const html = layout({
    heading: "Confirm your email",
    preview: "One click to start using AI in EveryOps.",
    lines: [
      `Hi ${esc(p.name)},`,
      "Confirm this is your email address to start using AI in EveryOps: setting up workspaces, Ask EveryOps and voice input.",
    ],
    action: { label: "Confirm my email", url: p.url },
    footnote:
      "The link works for one hour. If you didn't create an EveryOps account, you can ignore this email.",
  });
  return { to: p.to, subject: "Confirm your email for EveryOps", text, html };
}
