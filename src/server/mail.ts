import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email over SMTP (Hostinger mail for notify@everyops.app).
 * Without SMTP settings, messages go to the server log so local development still works.
 */
export type Mail = { to: string; subject: string; text: string; html: string };

let transport: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    transport = null;
    return null;
  }
  const port = Number(SMTP_PORT ?? 465);
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

export const mailEnabled = () => getTransport() !== null;

/** Sends one message. Returns false (and logs) instead of throwing, so a mail outage never breaks the request. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const t = getTransport();
  if (!t) {
    console.info(`[mail] SMTP isn't configured. To ${mail.to}: ${mail.subject}\n${mail.text}`);
    return false;
  }
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM ?? `EveryOps <${process.env.SMTP_USER}>`,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    console.info(JSON.stringify({ event: "mail", to: mail.to, subject: mail.subject, ok: true }));
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({ event: "mail", to: mail.to, subject: mail.subject, ok: false, error: String(error) }),
    );
    return false;
  }
}

/** The public address of the app, used in links inside emails. */
export function appUrl(path = "") {
  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}${path}`;
}
