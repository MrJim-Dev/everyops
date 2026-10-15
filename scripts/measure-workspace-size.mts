/**
 * Measures how workspace size affects opening, saving and polling, against a LOCAL database and server only.
 * Seeds workspaces with 1k, 10k and 50k bookings (the court bookings sample, repeated back in time), then times:
 * GET /api/workspaces/ID (what opening a workspace loads, with its size), a one-record PATCH (a save), and
 * GET /records?since= (an open tab's 30-second poll). Prints one JSON line per size.
 *
 *   MEASURE_BASE=http://localhost:3104 tsx --conditions=react-server --env-file=.env.local scripts/measure-workspace-size.mts
 */
import { gzipSync } from "node:zlib";
import { sql } from "kysely";
import type { DataRecord } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const BASE = process.env.MEASURE_BASE ?? "http://localhost:3000";
const SIZES = (process.env.MEASURE_SIZES ?? "1000,10000,50000").split(",").map(Number);
const USER = { name: "Size QA", email: "qa-size@everyops.test", password: "qa-size-2026" };
const DAY = 86_400_000;

async function ownerId() {
  const found = await sql<{ id: string }>`select id from "user" where email = ${USER.email}`.execute(db);
  return found.rows[0]?.id ?? (await auth.api.signUpEmail({ body: USER })).user.id;
}

async function seed(size: number, owner: string) {
  const slug = `size-${size}`;
  const now = new Date();
  const { blueprint, records } = courtBookingsSample(now, "Court House PH");
  const base = records.filter((r) => r.entityId === "booking");
  const others = records.filter((r) => r.entityId !== "booking");
  const out: DataRecord[] = [...others];
  for (let i = 0; out.length - others.length < size; i++) {
    const b = base[i % base.length];
    const shift = Math.floor(i / base.length) * 7 * DAY;
    const slot = b.data.slot as { start: string; end: string };
    out.push({
      ...b,
      id: `${b.id}_${i}`,
      data: {
        ...b.data,
        slot: {
          start: new Date(Date.parse(slot.start) - shift).toISOString(),
          end: new Date(Date.parse(slot.end) - shift).toISOString(),
        },
      },
    });
  }
  await sql`delete from workspace where id = ${slug}`.execute(db);
  const at = now.toISOString();
  const meta = {
    name: `Court House (${size} bookings)`,
    summary: "Size test",
    createdAt: at,
    openedAt: at,
    currentVersion: 1,
  };
  await sql`insert into workspace (id, owner_id, doc) values (${slug}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, slug, { slug, ...meta, versions: [blueprint], records: out, changes: [], docs: {} }),
    );
  // Seeded rows count as changed an hour ago, so the poll measures a normal open tab, not a fresh import.
  await sql`update workspace_record set changed_at = now() - interval '1 hour' where workspace_id = ${slug}`.execute(
    db,
  );
  return slug;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timed(url: string, init: RequestInit = {}) {
  const t = performance.now();
  const res = await fetch(url, init);
  const body = await res.text();
  // fetch decodes gzip and hides the size that crossed the network; gzipping the body again gives it.
  const wire = res.headers.get("content-encoding") === null ? Buffer.byteLength(body) : gzipSync(body).length;
  return { ms: performance.now() - t, status: res.status, bytes: Buffer.byteLength(body), wire, body };
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const owner = await ownerId();
  const signin = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: USER.email, password: USER.password }),
  });
  const cookie = (signin.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`sign-in failed: ${signin.status}`);
  const headers = { cookie, origin: BASE };
  for (const size of SIZES) {
    const seedStart = performance.now();
    const slug = await seed(size, owner);
    const seedMs = performance.now() - seedStart;
    const loads = [];
    let loaded: { ms: number; bytes: number; wire: number; body: string } | undefined;
    for (let i = 0; i < 3; i++) {
      loaded = await timed(`${BASE}/api/workspaces/${slug}`, {
        headers: { ...headers, "accept-encoding": "gzip" },
      });
      loads.push(loaded);
    }
    const parsed = JSON.parse(loaded?.body ?? "{}") as {
      workspace?: { records: DataRecord[] };
      revs?: Record<string, number>;
    };
    const target = parsed.workspace?.records.find((r) => r.entityId === "booking");
    const saves = [];
    for (let i = 0; i < 3 && target; i++) {
      const rev = (parsed.revs?.[target.id] ?? 1) + i;
      const record = {
        ...target,
        data: { ...target.data, source: i % 2 ? "phone" : "messenger" },
        updatedAt: new Date().toISOString(),
      };
      saves.push(
        await timed(`${BASE}/api/workspaces/${slug}`, {
          method: "PATCH",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ records: { put: [{ record, rev }], delete: [] } }),
        }),
      );
    }
    const since = new Date(Date.now() - 60_000).toISOString();
    const polls = [];
    for (let i = 0; i < 3; i++)
      polls.push(
        await timed(`${BASE}/api/workspaces/${slug}/records?since=${encodeURIComponent(since)}`, { headers }),
      );
    console.log(
      JSON.stringify({
        size,
        records: parsed.workspace?.records.length,
        seedMs: Math.round(seedMs),
        openMs: Math.round(median(loads.map((l) => l.ms))),
        openMB: Number(((loaded?.bytes ?? 0) / 1_000_000).toFixed(2)),
        sentMB: Number(((loaded?.wire ?? 0) / 1_000_000).toFixed(2)),
        saveMs: Math.round(median(saves.map((s) => s.ms))),
        saveStatus: saves.map((s) => s.status),
        pollMs: Math.round(median(polls.map((p) => p.ms))),
      }),
    );
  }
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
