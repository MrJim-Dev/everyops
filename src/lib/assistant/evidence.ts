/** Server-produced lookup metadata. Kept with the reply so its scope survives a reload. */
export type DataEvidence = {
  status: "success" | "no_matches" | "failed" | "truncated";
  checkedAt: string;
  queries: { label: string; scope: string; matched?: number; shown?: number }[];
};

export const EVIDENCE_LABELS: Record<DataEvidence["status"], string> = {
  success: "Data checked",
  no_matches: "No matching records",
  failed: "Data could not be checked",
  truncated: "Results need narrowing",
};
