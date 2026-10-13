"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Local auth for the frontend build. Accounts live in this browser with
 * salted SHA-256 password hashes. The functions below (signIn, signUp,
 * requestReset, resetPassword, signOut) are the seam Firebase Auth replaces;
 * pages only call these and never touch storage.
 */

export type Account = {
  id: string;
  name: string;
  email: string;
  salt: string;
  passwordHash: string;
  createdAt: string;
};

type ResetToken = { token: string; accountId: string; expiresAt: string };

export type AuthResult = { ok: true } | { ok: false; field?: string; message: string };

type AuthState = {
  accounts: Account[];
  sessionId: string | null;
  resets: ResetToken[];
  seeded: boolean;
  seed: () => Promise<void>;
  signUp: (input: { name: string; email: string; password: string }) => Promise<AuthResult>;
  signIn: (input: { email: string; password: string }) => Promise<AuthResult>;
  signOut: () => void;
  requestReset: (email: string) => Promise<string | null>;
  resetPassword: (token: string, password: string) => Promise<AuthResult>;
};

export const DEMO_ACCOUNT = { name: "James Ocampo", email: "james@hulma.app", password: "hulma2026" };

const RESET_TTL_MS = 30 * 60 * 1000;
let seeding = false;
const normalize = (email: string) => email.trim().toLowerCase();

function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hash(password: string, salt: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeAccount(name: string, email: string, password: string): Promise<Account> {
  const salt = randomHex();
  return {
    id: `acct_${randomHex(6)}`,
    name: name.trim(),
    email: normalize(email),
    salt,
    passwordHash: await hash(password, salt),
    createdAt: new Date().toISOString(),
  };
}

/** Small, consistent delay so buttons show their pending state like a real request. */
const settle = () => new Promise((r) => setTimeout(r, 450));

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accounts: [],
      sessionId: null,
      resets: [],
      seeded: false,

      seed: async () => {
        if (get().seeded || seeding) return;
        // Hydration can fire twice; the flag and the email check keep one demo account.
        seeding = true;
        const demo = await makeAccount(DEMO_ACCOUNT.name, DEMO_ACCOUNT.email, DEMO_ACCOUNT.password);
        set((s) =>
          s.accounts.some((a) => a.email === demo.email)
            ? { seeded: true }
            : { accounts: [...s.accounts, demo], seeded: true },
        );
        seeding = false;
      },

      signUp: async ({ name, email, password }) => {
        await settle();
        if (get().accounts.some((a) => a.email === normalize(email)))
          return { ok: false, field: "email", message: "An account with this email already exists" };
        const account = await makeAccount(name, email, password);
        set((s) => ({ accounts: [...s.accounts, account], sessionId: account.id }));
        return { ok: true };
      },

      signIn: async ({ email, password }) => {
        await settle();
        const account = get().accounts.find((a) => a.email === normalize(email));
        // Same message for unknown email and wrong password, so accounts can't be probed.
        if (!account || (await hash(password, account.salt)) !== account.passwordHash)
          return { ok: false, message: "That email and password don't match" };
        set({ sessionId: account.id });
        return { ok: true };
      },

      signOut: () => set({ sessionId: null }),

      requestReset: async (email) => {
        await settle();
        const account = get().accounts.find((a) => a.email === normalize(email));
        if (!account) return null;
        const token = randomHex(20);
        const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
        set((s) => ({
          resets: [
            ...s.resets.filter((r) => r.accountId !== account.id),
            { token, accountId: account.id, expiresAt },
          ],
        }));
        return token;
      },

      resetPassword: async (token, password) => {
        await settle();
        const reset = get().resets.find((r) => r.token === token);
        if (!reset || Date.parse(reset.expiresAt) < Date.now())
          return { ok: false, message: "This reset link has expired. Request a new one." };
        const salt = randomHex();
        const passwordHash = await hash(password, salt);
        set((s) => ({
          accounts: s.accounts.map((a) => (a.id === reset.accountId ? { ...a, salt, passwordHash } : a)),
          resets: s.resets.filter((r) => r.token !== token),
          sessionId: null,
        }));
        return { ok: true };
      },
    }),
    {
      name: "hulma.auth",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accounts: s.accounts,
        sessionId: s.sessionId,
        resets: s.resets,
        seeded: s.seeded,
      }),
      skipHydration: true,
    },
  ),
);

/** The signed-in account, or null. */
export function useCurrentUser(): Account | null {
  return useAuth((s) => s.accounts.find((a) => a.id === s.sessionId) ?? null);
}
