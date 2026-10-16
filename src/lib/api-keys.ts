import type { Role } from "@/lib/store/workspace-model";

/**
 * API keys, the parts shared by the server and the account page: what a key may do, how its secret looks, and what
 * it can do in a workspace once its owner's role there is known.
 */

export const PERMISSIONS = [
  "records:read",
  "records:write",
  "pages:read",
  "pages:write",
  "design:propose",
  "design:apply",
  "manage",
  "mcp",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, { label: string; detail: string }> = {
  "records:read": { label: "Read records", detail: "List, search and open records" },
  "records:write": { label: "Write records", detail: "Add, change and delete records (staff and up)" },
  "pages:read": { label: "Read pages", detail: "How tabs, layouts and cards are set up, and page text" },
  "pages:write": { label: "Write pages", detail: "Change document pages and drawings (staff and up)" },
  "design:propose": {
    label: "Propose design changes",
    detail: "Plans an owner or admin applies (admins and up)",
  },
  "design:apply": {
    label: "Apply design changes",
    detail: "Apply Ask EveryOps plans for pages, fields and automations, undoable in History (admins and up)",
  },
  manage: {
    label: "Manage the workspace",
    detail: "Activity log, team, assistant memory and running automations (admins and up)",
  },
  mcp: { label: "Use with AI agents (MCP)", detail: "Claude, ChatGPT and other MCP clients" },
};

/** The roles that may use each permission in a workspace. A key never does more than its owner can. */
const NEEDS: Record<Permission, Role[]> = {
  "records:read": ["owner", "admin", "staff", "viewer"],
  "pages:read": ["owner", "admin", "staff", "viewer"],
  mcp: ["owner", "admin", "staff", "viewer"],
  "records:write": ["owner", "admin", "staff"],
  "pages:write": ["owner", "admin", "staff"],
  "design:propose": ["owner", "admin"],
  "design:apply": ["owner", "admin"],
  manage: ["owner", "admin"],
};

export const SECRET_PREFIX = "eo_live_";
const SECRET = /^eo_live_([a-z0-9]{8})_([A-Za-z0-9]{32})$/;

/** The key id inside a secret, or null when it isn't one of ours. */
export function keyIdOf(secret: string): string | null {
  return SECRET.exec(secret.trim())?.[1] ?? null;
}

/** The start of a secret shown in lists, enough to tell keys apart: eo_live_ab12cd34_… */
export const visiblePrefix = (id: string) => `${SECRET_PREFIX}${id}_`;

export type KeyScope = {
  /** Every workspace the account can open (null), or only these. */
  workspaces: string[] | null;
  permissions: Permission[];
};

/** Whether a key reaches a workspace at all, before roles. */
export const reaches = (key: KeyScope, workspaceId: string) =>
  key.workspaces === null || key.workspaces.includes(workspaceId);

/**
 * What a key may do in a workspace: its permissions, cut down to what its owner's current role there allows. A key
 * made by an admin who is later made staff loses design proposals on the next request; one whose owner left the
 * workspace (role null) can do nothing there.
 */
export function allowedIn(key: KeyScope, workspaceId: string, role: Role | null): Set<Permission> {
  if (!role || !reaches(key, workspaceId)) return new Set();
  return new Set(key.permissions.filter((p) => NEEDS[p].includes(role)));
}

export type KeyStatus = "active" | "expired" | "revoked";
export function keyStatus(
  key: { expiresAt: string | null; revokedAt: string | null },
  now = new Date(),
): KeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= now.getTime()) return "expired";
  return "active";
}

/** A key as the account page and the API show it: never the secret or its hash. */
export type ApiKeyInfo = {
  id: string;
  name: string;
  prefix: string;
  workspaces: string[] | null;
  permissions: Permission[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  createdAt: string;
};
