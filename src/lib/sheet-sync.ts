/**
 * Google Sheets sync: a record type kept up to date from a shared sheet. The column mapping is saved by header name,
 * so the owner can reorder or add columns; a mapped column that disappears stops the sync with a plain reason.
 */

export type SyncMapping = { header: string; fieldId: string }[];

/** How often a sheet is read again (the cron job runs every 15 minutes). */
export const SYNC_MINUTES = 15;

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** The import dialog's mapping (field per column index) saved by header name. */
export function mappingByHeader(headers: string[], mapping: (string | null)[]): SyncMapping {
  return mapping.flatMap((fieldId, i) => (fieldId && headers[i] ? [{ header: headers[i], fieldId }] : []));
}

/** A saved mapping laid onto the sheet's current headers, and the mapped headers it no longer has. */
export function mappingForHeaders(
  headers: string[],
  saved: SyncMapping,
): { mapping: (string | null)[]; missing: string[] } {
  const at = new Map(headers.map((h, i) => [norm(h), i]));
  const mapping: (string | null)[] = headers.map(() => null);
  const missing: string[] = [];
  for (const m of saved) {
    const i = at.get(norm(m.header));
    if (i === undefined) missing.push(m.header);
    else mapping[i] = m.fieldId;
  }
  return { mapping, missing };
}
