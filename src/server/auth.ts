import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { DEMO_LOCKED_MESSAGE, isDemoEmail } from "@/lib/auth/demo";
import { googleAccountLinking } from "./auth-linking";
import { db } from "./db";
import { resetPasswordEmail } from "./emails";
import { sendMail } from "./mail";
import { registrationWhitelist } from "./registration-whitelist";

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
    : undefined;

export const googleEnabled = Boolean(google);

/** Extra origins allowed to call the auth API, e.g. the run.app URL next to the custom domain. */
const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** Account endpoints the shared demo account may not use: its login stays the same for everyone. */
const DEMO_LOCKED_PATHS = new Set(["/update-user", "/change-password", "/change-email", "/delete-user"]);

export const auth = betterAuth({
  appName: "EveryOps",
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET,
  database: { db, type: "postgres" },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 30 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(resetPasswordEmail({ to: user.email, name: user.name, url }));
    },
  },
  socialProviders: google ? { google } : {},
  ...googleAccountLinking,
  databaseHooks: { ...googleAccountLinking.databaseHooks, ...registrationWhitelist.databaseHooks },
  user: { deleteUser: { enabled: true } },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: { enabled: true, window: 60, max: 100 },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/request-password-reset" && isDemoEmail((ctx.body as { email?: string })?.email))
        throw new APIError("FORBIDDEN", { message: DEMO_LOCKED_MESSAGE });
      if (!DEMO_LOCKED_PATHS.has(ctx.path)) return;
      const session = await getSessionFromCtx(ctx);
      if (isDemoEmail(session?.user.email)) throw new APIError("FORBIDDEN", { message: DEMO_LOCKED_MESSAGE });
    }),
  },
  // nextCookies must stay last so cookies set by server actions reach the browser.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
