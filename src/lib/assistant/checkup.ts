/**
 * "Things to fix": what the assistant notices when it compares the workspace with what it knows about the business.
 * Each finding names its evidence and carries a fix written as a request, sent to the assistant like any message
 * (so the workspace's permissions decide whether it waits for approval).
 */
export const FINDING_KINDS = ["mismatch", "missing", "stale_page", "data"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export type Finding = {
  id: string;
  kind: FindingKind;
  title: string;
  detail: string;
  /** Where it shows: "Memory: peak ₱500/hr · Rate per hour formula: 400". */
  evidence: string;
  /** The request that fixes it, in the owner's words. */
  fix: string;
};

export type Checkup = { key: string; findings: Finding[]; checkedAt: string };

export const KIND_LABEL: Record<FindingKind, string> = {
  mismatch: "Doesn't match",
  missing: "Missing",
  stale_page: "Out of date",
  data: "Data",
};

/** What a check depends on: the design version and the last memory change. */
export const checkupKey = (version: number, memoryUpdatedAt: string | null) =>
  `v${version}:${memoryUpdatedAt ?? "none"}`;
