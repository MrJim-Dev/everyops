import { z } from "zod";
import { fileSlug } from "@/lib/download";
import { apiUser, sameOrigin } from "@/server/session-api";

const body = z.object({
  name: z.string().min(1).max(120),
  columns: z
    .array(
      z.object({
        header: z.string().max(200),
        format: z.enum(["text", "number", "money", "percent", "date", "datetime"]),
      }),
    )
    .min(1)
    .max(200),
  rows: z.array(z.array(z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]))).max(50_000),
});

const FORMATS = {
  number: "#,##0.##",
  money: '"₱"#,##0.00',
  percent: '0.##"%"',
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm",
} as const;

/**
 * A table view as an Excel workbook: one sheet with a bold, frozen header row, numbers as numbers in peso or plain
 * formats, and dates as real dates, so the file sorts and sums in Excel and Google Sheets. The browser sends the rows it
 * shows (with the view's filter and columns); nothing is read or stored here.
 */
export async function POST(request: Request) {
  const { error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Nothing to export." }, { status: 400 });
  const { name, columns, rows } = parsed.data;
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EveryOps";
  const sheet = workbook.addWorksheet(name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Export", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns.map((c) => ({
    header: c.header,
    width: Math.min(48, Math.max(10, c.header.length + 4)),
    ...(c.format in FORMATS ? { style: { numFmt: FORMATS[c.format as keyof typeof FORMATS] } } : {}),
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows)
    sheet.addRow(
      row.map((cell, i) => {
        const format = columns[i]?.format;
        // Dates are written as Manila wall time; Excel has no time zones, so it shows them as written.
        if ((format === "date" || format === "datetime") && typeof cell === "string") {
          const d = new Date(format === "date" ? `${cell}T00:00:00Z` : `${cell}:00Z`);
          return Number.isNaN(d.getTime()) ? cell : d;
        }
        return cell;
      }),
    );
  for (const [i, c] of columns.entries()) {
    if (c.format !== "text") continue;
    const longest = rows.reduce((n, r) => Math.max(n, String(r[i] ?? "").length), c.header.length);
    sheet.getColumn(i + 1).width = Math.min(48, Math.max(10, longest + 2));
  }
  const bytes = await workbook.xlsx.writeBuffer();
  return new Response(bytes as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileSlug(name)}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
