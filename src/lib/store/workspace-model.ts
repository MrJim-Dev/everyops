/**
 * Workspace model shared by the browser store and the server. The workspace row holds its settings (name, current
 * version, setup conversation); records, blueprint versions, history and page text each live in their own table
 * (see src/server/workspace-data.ts), as do the owner, members and invites, so access is checked in SQL and a change
 * to one record writes one row.
 */

import type { AttachmentRef } from "@/lib/assistant/attachments";
import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { DEMO_WORKSPACES } from "@/lib/catalog/demo-workspaces";
import type { ChangePlan, RecordChange } from "@/lib/engine/changes";

export type Role = "owner" | "admin" | "staff" | "viewer";
export type MemberRole = Exclude<Role, "owner">;
export const ROLES: { id: MemberRole; label: string; description: string }[] = [
  { id: "admin", label: "Admin", description: "Manage systems, settings and the team" },
  { id: "staff", label: "Staff", description: "Add and edit records" },
  { id: "viewer", label: "Viewer", description: "View only" },
];
export type Member = { accountId: string; name: string; email: string; role: MemberRole; joinedAt: string };
export type Invite = { token: string; email: string; role: MemberRole; invitedAt: string; invitedBy: string };

/** One turn of the Ask EveryOps setup conversation. */
export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  /** Files the owner sent with this message (stored under their account). */
  attachments?: AttachmentRef[];
  suggestions?: string[];
  /** Set on the turn where Gemini decided to design, so an interrupted design can resume. */
  brief?: string;
  workspaceName?: string;
};
export type ProfileLine = { label: string; value: string };
/** A workspace Gemini designed, waiting for the owner to create it. */
export type SetupDraft = {
  name: string;
  summary: string;
  data: WorkspaceData;
  preview: { label: string; detail: string }[];
};
/** Where the setup conversation is, so a refresh or another device picks it up. */
export type SetupProgress = {
  messages: ChatTurn[];
  profile: ProfileLine[];
  /** What Ask EveryOps plans to set up, shown beside the conversation. */
  plan?: string[];
  draft?: SetupDraft;
};

export type ChangeEntry = {
  id: string;
  request: string;
  title: string;
  steps: ChangePlan["steps"];
  fromVersion: number;
  toVersion: number;
  recordChanges: RecordChange[];
  appliedAt: string;
  undoneAt?: string;
  /** Records the change added, removed again on undo. */
  createdRecordIds?: string[];
  /** Records as they were before the change edited them, restored on undo. */
  replacedRecords?: DataRecord[];
  /** Records the change deleted (directly, or with their record type), put back on undo. */
  removedRecords?: DataRecord[];
  /** Page text the change replaced, by view id; null when the page had none. Restored on undo. */
  replacedDocs?: Record<string, PageDoc | null>;
  /** The team as it was before the change invited people or changed roles. Restored on undo. */
  teamBefore?: { members: Member[]; invites: Invite[] };
};

export type Workspace = {
  /** Globally unique id, also the URL segment: /w/[slug]. */
  slug: string;
  name: string;
  summary: string;
  createdAt: string;
  openedAt: string;
  source?: { systemId: string; version: string };
  /** Every blueprint version; versions[n - 1] is version n. */
  versions: Blueprint[];
  currentVersion: number;
  records: DataRecord[];
  changes: ChangeEntry[];
  /** Markdown of document pages, by view id. Edited like records, so staff can write them too. */
  docs?: Record<string, PageDoc>;
  /** Filled in by the server from the workspace table. */
  ownerId?: string;
  owner?: { name: string; email: string };
  members?: Member[];
  /** Only sent to owners and admins. */
  invites?: Invite[];
  /** Set while Ask EveryOps is still setting the workspace up. */
  setup?: { prompt: string; attachments?: AttachmentRef[]; progress?: SetupProgress };
  /** Server time when the records were last read; an open tab asks for what changed since. Never stored. */
  syncedAt?: string;
  /**
   * False for a workspace list summary: its records, history, page text and older versions load when it opens.
   * Never stored.
   */
  loaded?: boolean;
  /** The current blueprint, sent with list summaries instead of every version. */
  current?: Blueprint;
  /** Record counts, sent with list summaries. */
  stats?: { records: number; recordsThisWeek: number };
};

/** A whole workspace's content (settings, versions, records, history, page text), as the demo snapshot keeps it. */
export type WorkspaceDoc = Omit<
  Workspace,
  "ownerId" | "owner" | "members" | "invites" | "syncedAt" | "loaded" | "current" | "stats"
>;

export type PageDoc = { body: string; updatedAt: string };

/**
 * The history a staff save may write. Staff can't change the design or the team, so they only add entries for
 * data and page-text changes at the current version (like an assistant plan that deletes a record), and mark
 * such entries undone. Everything else stays as stored.
 */
export function mergeStaffChanges(
  stored: ChangeEntry[],
  incoming: ChangeEntry[],
  currentVersion: number,
): ChangeEntry[] {
  const dataOnly = (c: ChangeEntry) =>
    c.fromVersion === currentVersion && c.toVersion === currentVersion && !c.teamBefore;
  const known = new Map(stored.map((c) => [c.id, c]));
  const added = incoming.filter((c) => !known.has(c.id) && dataOnly(c));
  const undone = new Map(incoming.filter((c) => c.undoneAt).map((c) => [c.id, c.undoneAt]));
  return [
    ...added,
    ...stored.map((c) =>
      dataOnly(c) && !c.undoneAt && undone.has(c.id) ? { ...c, undoneAt: undone.get(c.id) } : c,
    ),
  ];
}

export type NewWorkspace = {
  name: string;
  summary: string;
  data: WorkspaceData;
  source?: Workspace["source"];
  setup?: Workspace["setup"];
  slug?: string;
};

export function roleOf(ws: Workspace | undefined, accountId: string | null | undefined): Role | null {
  if (!ws || !accountId) return null;
  if (ws.ownerId === accountId) return "owner";
  return ws.members?.find((m) => m.accountId === accountId)?.role ?? null;
}
export const canManage = (role: Role | null) => role === "owner" || role === "admin";
export const canEdit = (role: Role | null) => role === "owner" || role === "admin" || role === "staff";

export function blueprintOf(ws: Pick<Workspace, "versions" | "currentVersion" | "current">): Blueprint {
  return ws.versions[ws.currentVersion - 1] ?? ws.current;
}
/** How many records a workspace has, whether its records are loaded or it's a list summary. */
export const recordCount = (ws: Workspace) =>
  ws.loaded === false ? (ws.stats?.records ?? 0) : ws.records.length;
export function dataOf(ws: Workspace): WorkspaceData {
  return { blueprint: blueprintOf(ws), records: ws.records };
}

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "workspace";

export function randomToken(bytes = 12) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** URL-friendly and unique across accounts: "court-house-7f3a". */
export const newWorkspaceId = (name: string) => `${slugify(name)}-${randomToken(2)}`;

export function workspaceFrom(input: NewWorkspace, slug: string, now: string): Workspace {
  return {
    slug,
    name: input.name,
    summary: input.summary,
    createdAt: now,
    openedAt: now,
    source: input.source,
    versions: [{ ...input.data.blueprint, version: 1, workspaceName: input.name }],
    currentVersion: 1,
    records: input.data.records,
    changes: [],
    setup: input.setup,
  };
}

/** The four demo workspaces every new account starts with. */
export function demoWorkspaces(now = new Date()): Workspace[] {
  const stamp = now.toISOString();
  return DEMO_WORKSPACES.map((demo, i) => {
    const ws = workspaceFrom(
      {
        name: demo.name,
        summary: demo.summary,
        data: demo.build(now),
        source: demo.sourceId ? { systemId: demo.sourceId, version: "1.2" } : undefined,
      },
      newWorkspaceId(demo.slug),
      stamp,
    );
    // Stagger "last opened" so the recent list has a stable order.
    ws.openedAt = new Date(now.getTime() - i * 60_000).toISOString();
    return ws;
  });
}

export function toDoc(ws: Workspace): WorkspaceDoc {
  const {
    ownerId: _o,
    owner: _p,
    members: _m,
    invites: _i,
    syncedAt: _s,
    loaded: _l,
    current: _c,
    stats: _t,
    ...doc
  } = ws;
  return doc;
}
