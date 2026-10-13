import "server-only";
import type { Cell } from "exceljs";

/** Enough rows and columns for a price list, roster or inventory; Gemini sees at most 200k characters anyway. */
const MAX_ROWS = 5000;
const MAX_COLUMNS = 60;

const csvCell = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

/**
 * A cell's value as plain text: formula results rather than formulas, dates as YYYY-MM-DD (with the time when
 * there is one; Excel dates have no time zone, so they're read as written), rich text and links as their text.
 */
function cellText(cell: Cell): string {
  let value: unknown = cell.value;
  if (value && typeof value === "object" && "result" in value) value = (value as { result: unknown }).result;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    const time = iso.slice(11, 16);
    return time === "00:00" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
  }
  if (typeof value === "object") {
    if ("richText" in value)
      return (value as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("text" in value) return String((value as { text: unknown }).text);
    if ("error" in value) return String((value as { error: unknown }).error);
    return "";
  }
  return String(value);
}

/** Every visible sheet of an Excel workbook as CSV, one block per sheet. */
async function workbookText(bytes: Uint8Array): Promise<string | null> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheets: string[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible" && sheet.state !== undefined) continue;
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (lines.length >= MAX_ROWS) return;
      const cells: string[] = [];
      const width = Math.min(row.cellCount, MAX_COLUMNS);
      for (let c = 1; c <= width; c++) cells.push(csvCell(cellText(row.getCell(c)).trim()));
      while (cells.length && !cells.at(-1)) cells.pop();
      if (cells.length) lines.push(cells.join(","));
    });
    if (!lines.length) continue;
    const more = sheet.actualRowCount > MAX_ROWS ? `\n(only the first ${MAX_ROWS} rows)` : "";
    sheets.push(`${lines.join("\n")}${more}`);
    sheets[sheets.length - 1] =
      workbook.worksheets.length > 1 ? `Sheet "${sheet.name}":\n${sheets.at(-1)}` : sheets[sheets.length - 1];
  }
  return sheets.length ? sheets.join("\n\n") : null;
}

/** The text of a Word document, paragraph by paragraph (tables come out one cell per line). */
async function documentText(bytes: Uint8Array): Promise<string | null> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const text = value.replace(/\n{3,}/g, "\n\n").trim();
  return text || null;
}

/**
 * Turns an Excel (.xlsx) or Word (.docx) file into text Gemini can read, or null if it isn't a readable one
 * (a renamed zip, a password-protected file, an empty workbook).
 */
export async function officeText(bytes: Uint8Array, format: "xlsx" | "docx"): Promise<string | null> {
  try {
    return format === "xlsx" ? await workbookText(bytes) : await documentText(bytes);
  } catch {
    return null;
  }
}
