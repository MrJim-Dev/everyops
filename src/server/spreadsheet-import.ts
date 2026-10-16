import "server-only";
import { MAX_IMPORT_ROWS, parseCsv, type Table, tableOf } from "@/lib/engine/import";
import { workbookSheets } from "./ai/office";

/** The largest spreadsheet an import reads. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export type ImportSheet = Table & { name: string; truncated: boolean };
export type ReadResult = { ok: true; sheets: ImportSheet[] } | { ok: false; message: string };

const capped = (name: string, table: Table, more = false): ImportSheet => ({
  name,
  headers: table.headers,
  rows: table.rows.slice(0, MAX_IMPORT_ROWS),
  truncated: more || table.rows.length > MAX_IMPORT_ROWS,
});

/** A CSV or Excel file as tables, one per sheet. */
export async function readSpreadsheet(name: string, bytes: Uint8Array): Promise<ReadResult> {
  if (bytes.byteLength > MAX_IMPORT_BYTES)
    return { ok: false, message: "That file is over 10 MB. Split it into smaller files." };
  const lower = name.toLowerCase();
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (lower.endsWith(".xlsx") || zip) {
    const sheets = await workbookSheets(bytes);
    if (!sheets)
      return {
        ok: false,
        message: "That Excel file couldn't be read. Save it as .xlsx or CSV and try again.",
      };
    const tables = sheets
      .map((s) => capped(s.name, tableOf(s.lines), s.more))
      .filter((t) => t.headers.length);
    return tables.length
      ? { ok: true, sheets: tables }
      : { ok: false, message: "That workbook has no rows." };
  }
  if (lower.endsWith(".xls"))
    return { ok: false, message: "Old .xls files aren't supported. Save it as .xlsx or CSV in Excel first." };
  const text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\u0000")) return { ok: false, message: "That doesn't look like a CSV or Excel file." };
  const table = parseCsv(text);
  if (!table.headers.length) return { ok: false, message: "That file is empty." };
  return { ok: true, sheets: [capped(name.replace(/\.(csv|tsv|txt)$/i, ""), table)] };
}

/** A Google Sheets link: the spreadsheet id and the tab (gid) it points at. */
export function sheetLink(url: string): { id: string; gid: string } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  const id = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(u.pathname)?.[1];
  if (!id) return null;
  const gid = /gid=(\d+)/.exec(`${u.hash} ${u.search}`)?.[1] ?? "0";
  return { id, gid };
}

/**
 * Reads one tab of a Google Sheet shared as "Anyone with the link". Only docs.google.com is fetched, so a link can't
 * point the server anywhere else. A sheet that isn't shared answers with a sign-in page, which is reported plainly.
 */
export async function readGoogleSheet(url: string): Promise<ReadResult> {
  const link = sheetLink(url);
  if (!link) return { ok: false, message: "Paste a Google Sheets link (docs.google.com/spreadsheets/…)." };
  const exportUrl = `https://docs.google.com/spreadsheets/d/${link.id}/export?format=csv&gid=${link.gid}`;
  let res: Response;
  try {
    res = await fetch(exportUrl, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch {
    return { ok: false, message: "Google Sheets didn't answer. Try again in a moment." };
  }
  const type = res.headers.get("content-type") ?? "";
  const host = new URL(res.url).hostname;
  if (
    !res.ok ||
    type.includes("text/html") ||
    (!host.endsWith("google.com") && !host.endsWith("googleusercontent.com"))
  )
    return {
      ok: false,
      message:
        "EveryOps can't open that sheet. In Google Sheets, choose Share → General access → Anyone with the link (Viewer), then try again.",
    };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMPORT_BYTES) return { ok: false, message: "That sheet is over 10 MB." };
  const table = parseCsv(new TextDecoder().decode(bytes));
  if (!table.headers.length) return { ok: false, message: "That sheet is empty." };
  return { ok: true, sheets: [capped("Google Sheet", table)] };
}
