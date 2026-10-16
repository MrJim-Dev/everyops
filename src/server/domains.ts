import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { sql } from "kysely";
import {
  APP_DOMAIN,
  type DnsAnswers,
  type DnsTargets,
  type DomainRoute,
  diagnose,
  recordsFor,
} from "@/lib/domains";
import { logActivity, personActor } from "./activity";
import { db } from "./db";
import { appUrl, sendMail } from "./mail";

/**
 * Custom domains for public pages. Owners and admins add a hostname; the cron job (and "Check now") reads its DNS,
 * explains what's wrong in plain words, and once DNS points at us has Certificate Manager issue its certificate and map
 * it on the load balancer. Requests on a live hostname are routed by src/proxy.ts with lookupHost.
 *
 * Platform settings (set once the load balancer exists; see scripts/setup-custom-domains.sh):
 *   DOMAINS_CNAME_TARGET   where subdomains point (default domains.everyops.app)
 *   DOMAINS_LB_IPV4/IPV6   the load balancer's addresses, for apex domains (comma separated)
 *   DOMAINS_CERT_MAP       projects/P/locations/global/certificateMaps/M, where certificates are mapped
 */

export const targets = (): DnsTargets => ({
  cname: process.env.DOMAINS_CNAME_TARGET || `domains.${APP_DOMAIN}`,
  ipv4: (process.env.DOMAINS_LB_IPV4 ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  ipv6: (process.env.DOMAINS_LB_IPV6 ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
});
const certMap = () => process.env.DOMAINS_CERT_MAP ?? "";
/** Whether certificates can be issued here (the load balancer and certificate map exist). */
export const platformReady = () => Boolean(certMap() && targets().ipv4.length);
/** Local hosts (*.localhost) need no DNS or certificate: they're live at once, for checking routing in a browser. */
const devHost = (host: string) => process.env.NODE_ENV !== "production" && host.endsWith(".localhost");

// ---- Routing (src/proxy.ts) ----

const cache = new Map<string, { at: number; route: DomainRoute | null }>();
// Each instance (and the proxy, which has its own copy) keeps lookups this long: a removed domain stops serving within it.
const TTL = 10_000;

/** The live domain a request's host serves, cached briefly. Unknown hosts are null (a 404, never another workspace). */
export async function lookupHost(host: string): Promise<DomainRoute | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.route;
  // Development and production share a database: *.localhost test domains never serve in production.
  if (!devHost(host) && host.endsWith(".localhost")) return null;
  const { rows } = await sql<{
    workspace_id: string;
    target: string;
  }>`select workspace_id, target from workspace_domain
    where hostname = ${host} and status = 'live' limit 1`.execute(db);
  const route = rows[0] ? { workspaceId: rows[0].workspace_id, target: rows[0].target } : null;
  cache.set(host, { at: Date.now(), route });
  return route;
}

const primaryCache = new Map<string, { at: number; host: string | null }>();

/** The workspace's primary live domain, where its old /s/<workspace> addresses redirect. */
export async function primaryDomain(workspaceId: string): Promise<string | null> {
  const hit = primaryCache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL) return hit.host;
  const { rows } = await sql<{ hostname: string }>`select hostname from workspace_domain
    where workspace_id = ${workspaceId} and status = 'live' and is_primary and target = 'home'
      and (hostname not like '%.localhost' or ${process.env.NODE_ENV !== "production"}) limit 1`.execute(db);
  const host = rows[0]?.hostname ?? null;
  primaryCache.set(workspaceId, { at: Date.now(), host });
  return host;
}

const forget = (host: string, workspaceId: string) => {
  cache.delete(host);
  primaryCache.delete(workspaceId);
};

// ---- Settings → Domains ----

type Row = {
  workspace_id: string;
  hostname: string;
  target: string;
  kind: "custom" | "subdomain";
  status: "pending" | "verifying" | "issuing" | "live" | "error";
  message: string | null;
  ownership_token: string | null;
  acme_name: string | null;
  acme_value: string | null;
  dns_authorization: string | null;
  certificate: string | null;
  map_entry: string | null;
  is_primary: boolean;
  checked_at: Date | null;
  live_at: Date | null;
};

export type DomainInfo = {
  hostname: string;
  target: string;
  kind: Row["kind"];
  status: Row["status"];
  message: string | null;
  primary: boolean;
  checkedAt: string | null;
  liveAt: string | null;
  records: ReturnType<typeof recordsFor>;
};

const info = (r: Row): DomainInfo => ({
  hostname: r.hostname,
  target: r.target,
  kind: r.kind,
  status: r.status,
  message: r.message,
  primary: r.is_primary,
  checkedAt: r.checked_at?.toISOString() ?? null,
  liveAt: r.live_at?.toISOString() ?? null,
  records:
    r.kind === "subdomain"
      ? []
      : recordsFor(r.hostname, targets(), {
          ...(r.acme_value ? { acme: r.acme_value } : {}),
          ...(r.ownership_token ? { ownership: r.ownership_token } : {}),
        }),
});

export async function listDomains(workspaceId: string): Promise<DomainInfo[]> {
  const { rows } =
    await sql<Row>`select * from workspace_domain where workspace_id = ${workspaceId} order by created_at`.execute(
      db,
    );
  return rows.map(info);
}

/** Custom domains per workspace. */
export const MAX_DOMAINS = 3;

export async function addDomain(
  workspaceId: string,
  userId: string,
  host: string,
  target: string,
  kind: Row["kind"] = "custom",
): Promise<{ ok: true; domain: DomainInfo } | { ok: false; message: string }> {
  const { rows: mine } = await sql<{
    n: number;
    dup: boolean;
  }>`select count(*) filter (where kind = 'custom')::int as n,
      bool_or(hostname = ${host}) as dup from workspace_domain where workspace_id = ${workspaceId}`.execute(
    db,
  );
  if (mine[0]?.dup) return { ok: false, message: "This workspace already has that domain." };
  if (kind === "custom" && (mine[0]?.n ?? 0) >= MAX_DOMAINS)
    return { ok: false, message: `A workspace can have up to ${MAX_DOMAINS} custom domains.` };
  const { rows: others } = await sql<{
    status: string;
  }>`select status from workspace_domain where hostname = ${host}`.execute(db);
  if (kind === "subdomain" && others.length) return { ok: false, message: "That subdomain is taken." };
  // Someone else claimed it first: this workspace has to prove it owns the domain with a TXT record.
  const ownership = others.length ? `everyops-verify=${randomBytes(12).toString("hex")}` : null;
  // Local *.localhost hosts are live at once (development only); real domains go through DNS and the certificate.
  const live = devHost(host);
  await sql`insert into workspace_domain (workspace_id, hostname, target, kind, status, message, ownership_token, created_by,
      is_primary, live_at, checked_at)
    values (${workspaceId}, ${host}, ${target}, ${kind}, ${live ? "live" : "pending"},
      ${live ? null : "Add the DNS records below, then check."}, ${ownership}, ${userId},
      ${target === "home"} and not exists (select 1 from workspace_domain where workspace_id = ${workspaceId} and is_primary),
      ${live ? new Date() : null}, ${live ? new Date() : null})`.execute(db);
  await logActivity(db, personActor(userId), { workspaceId, action: "domain.add", target: host, count: 1 });
  forget(host, workspaceId);
  if (!live && platformReady())
    await authorize(workspaceId, host).catch((e) =>
      setStatus(workspaceId, host, "pending", (e as Error).message),
    );
  const row = await getRow(workspaceId, host);
  return { ok: true, domain: info(row as Row) };
}

async function getRow(workspaceId: string, host: string) {
  const { rows } =
    await sql<Row>`select * from workspace_domain where workspace_id = ${workspaceId} and hostname = ${host}`.execute(
      db,
    );
  return rows[0] ?? null;
}

async function setStatus(workspaceId: string, host: string, status: Row["status"], message: string | null) {
  await sql`update workspace_domain set status = ${status}, message = ${message}, checked_at = now(),
      live_at = case when ${status} = 'live' then coalesce(live_at, now()) else live_at end
    where workspace_id = ${workspaceId} and hostname = ${host}`.execute(db);
  forget(host, workspaceId);
}

export async function setPrimary(workspaceId: string, host: string) {
  const { numAffectedRows } =
    await sql`update workspace_domain set is_primary = (hostname = ${host}) where workspace_id = ${workspaceId}
    and exists (select 1 from workspace_domain where workspace_id = ${workspaceId} and hostname = ${host} and target = 'home')`.execute(
      db,
    );
  primaryCache.delete(workspaceId);
  return Number(numAffectedRows ?? 0) > 0;
}

/**
 * Removes a domain: its certificate map entry, certificate and DNS authorization are deleted first, then the row (so
 * the host 404s at once). Warns when DNS still points at us, since a dangling record could be claimed by someone else.
 */
export async function removeDomain(
  workspaceId: string,
  host: string,
  userId: string,
): Promise<{ ok: boolean; warning?: string }> {
  const row = await getRow(workspaceId, host);
  if (!row) return { ok: false };
  for (const name of [row.map_entry, row.certificate, row.dns_authorization])
    if (name) await cm("DELETE", name).catch(() => null);
  await sql`delete from workspace_domain where workspace_id = ${workspaceId} and hostname = ${host}`.execute(
    db,
  );
  forget(host, workspaceId);
  await logActivity(db, personActor(userId), {
    workspaceId,
    action: "domain.remove",
    target: host,
    count: 1,
  });
  if (row.kind === "subdomain" || devHost(host)) return { ok: true };
  const answers = await readDns(host);
  const still = diagnose(host, answers, targets()).state === "ok";
  return {
    ok: true,
    ...(still
      ? {
          warning: `${host} still points to EveryOps. Remove that DNS record so nobody else can claim it later.`,
        }
      : {}),
  };
}

// ---- DNS and certificates ----

const settle = async <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

/** CAA records for a host: the closest ones up the tree apply. */
async function readCaa(host: string) {
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const found = await settle(dns.resolveCaa(labels.slice(i).join(".")), []);
    const records = found.flatMap((r) =>
      r.issue
        ? [{ tag: "issue", value: r.issue }]
        : r.issuewild
          ? [{ tag: "issuewild", value: r.issuewild }]
          : [],
    );
    if (found.length) return records;
  }
  return [];
}

async function readDns(host: string, withTxt = false): Promise<DnsAnswers> {
  const [cname, a, aaaa, caa, txt] = await Promise.all([
    settle(dns.resolveCname(host), [] as string[]),
    settle(dns.resolve4(host), [] as string[]),
    settle(dns.resolve6(host), [] as string[]),
    readCaa(host),
    withTxt
      ? settle(dns.resolveTxt(`_everyops.${host}`), [] as string[][])
      : Promise.resolve([] as string[][]),
  ]);
  return { cname, a, aaaa, caa, txt: txt.map((t) => t.join("")) };
}

/**
 * Checks one domain and moves it along: Waiting for DNS → Verifying (DNS right, certificate starting) → Issuing
 * certificate → Live. Errors explain themselves (wrong CNAME, CAA blocks Google, certificate failed).
 */
export async function checkDomain(workspaceId: string, host: string): Promise<DomainInfo | null> {
  const row = await getRow(workspaceId, host);
  if (!row) return null;
  if (row.kind === "subdomain" || devHost(host)) {
    if (row.status !== "live") await setStatus(workspaceId, host, "live", null);
  } else
    await advance(row).catch((e) =>
      // Certificate Manager is still creating something, or refused: the next check carries on from here.
      setStatus(
        workspaceId,
        host,
        row.status === "pending" ? "verifying" : row.status,
        `Setting up the certificate: ${(e as Error).message.slice(0, 200)}`,
      ),
    );
  const after = await getRow(workspaceId, host);
  if (after && after.status === "live" && row.status !== "live") await tellOwner(after);
  return after ? info(after) : null;
}

async function advance(row: Row) {
  const answers = await readDns(row.hostname, !!row.ownership_token);
  const verdict = diagnose(row.hostname, answers, targets(), row.ownership_token ?? undefined);
  if (verdict.state !== "ok")
    return setStatus(
      row.workspace_id,
      row.hostname,
      verdict.state === "wrong" ? "error" : "pending",
      verdict.message,
    );
  if (!platformReady())
    return setStatus(
      row.workspace_id,
      row.hostname,
      "verifying",
      "DNS is right. Certificates start once EveryOps' custom-domain load balancer is switched on.",
    );
  if (!row.dns_authorization) await authorize(row.workspace_id, row.hostname);
  const fresh = (await getRow(row.workspace_id, row.hostname)) as Row;
  const id = resourceId(row.hostname);
  if (!fresh.certificate) {
    const name = `${location()}/certificates/${id}`;
    await create(`certificates?certificateId=${id}`, {
      managed: { domains: [row.hostname], dnsAuthorizations: [fresh.dns_authorization] },
    });
    await sql`update workspace_domain set certificate = ${name} where workspace_id = ${row.workspace_id} and hostname = ${row.hostname}`.execute(
      db,
    );
    fresh.certificate = name;
  }
  if (!fresh.map_entry) {
    await create(`${certMap()}/certificateMapEntries?certificateMapEntryId=${id}`, {
      hostname: row.hostname,
      certificates: [fresh.certificate],
    });
    await sql`update workspace_domain set map_entry = ${`${certMap()}/certificateMapEntries/${id}`} where workspace_id = ${row.workspace_id} and hostname = ${row.hostname}`.execute(
      db,
    );
  }
  const cert = await cm("GET", fresh.certificate as string);
  const state = cert.managed?.state;
  if (state === "ACTIVE") {
    // Another workspace held this hostname: proving ownership moves it here.
    await sql`update workspace_domain set status = 'error', message = 'Moved to another workspace that proved it owns the domain.'
      where hostname = ${row.hostname} and workspace_id <> ${row.workspace_id} and status = 'live'`.execute(
      db,
    );
    return setStatus(row.workspace_id, row.hostname, "live", null);
  }
  if (state === "FAILED") {
    const issue = cert.managed?.provisioningIssue;
    return setStatus(
      row.workspace_id,
      row.hostname,
      "error",
      `The certificate couldn't be issued: ${issue?.details ?? issue?.reason ?? "unknown reason"}.`,
    );
  }
  return setStatus(
    row.workspace_id,
    row.hostname,
    "issuing",
    "Google is issuing the HTTPS certificate. This usually takes 10 to 60 minutes.",
  );
}

/** A DNS authorization for the host, so the certificate can be issued before traffic moves; its CNAME is shown. */
async function authorize(workspaceId: string, host: string) {
  const id = resourceId(host);
  await create(`dnsAuthorizations?dnsAuthorizationId=${id}`, { domain: host });
  const auth = await cm("GET", `${location()}/dnsAuthorizations/${id}`);
  await sql`update workspace_domain set dns_authorization = ${auth.name}, acme_name = ${auth.dnsResourceRecord?.name ?? null},
      acme_value = ${auth.dnsResourceRecord?.data ?? null} where workspace_id = ${workspaceId} and hostname = ${host}`.execute(
    db,
  );
}

/** A Certificate Manager resource id for a hostname: lowercase letters, digits and dashes, unique per host. */
export const resourceId = (host: string) =>
  `eo-${host.replace(/[^a-z0-9]+/g, "-").slice(0, 48)}-${createHash("sha256").update(host).digest("hex").slice(0, 8)}`;

type CmAnswer = {
  name: string;
  dnsResourceRecord?: { name: string; data: string };
  managed?: { state?: string; provisioningIssue?: { reason?: string; details?: string } };
};

const location = () => certMap().split("/certificateMaps/")[0];

/** Calls Certificate Manager as the service's account (the metadata server on Cloud Run) with a resource path. */
async function cm(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<CmAnswer> {
  const res = await fetch(`https://certificatemanager.googleapis.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as CmAnswer & { error?: { message: string } };
  if (!res.ok) throw new Error(`Certificate Manager ${res.status}: ${json.error?.message ?? res.statusText}`);
  return json;
}

/** Starts creating a resource (a long-running operation); one that already exists is fine. */
async function create(path: string, body: unknown) {
  await cm("POST", path.startsWith("projects/") ? path : `${location()}/${path}`, body).catch((e) => {
    if (!String(e).includes(" 409:")) throw e;
  });
}

async function accessToken(): Promise<string> {
  if (process.env.GCP_ACCESS_TOKEN) return process.env.GCP_ACCESS_TOKEN;
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "metadata-flavor": "Google" },
      signal: AbortSignal.timeout(3000),
    },
  );
  return ((await res.json()) as { access_token: string }).access_token;
}

async function tellOwner(row: Row) {
  const { rows } = await sql<{
    email: string;
    name: string;
  }>`select u.email, w.doc->>'name' as name from workspace w
    join "user" u on u.id = w.owner_id where w.id = ${row.workspace_id}`.execute(db);
  if (!rows[0] || devHost(row.hostname) || row.kind === "subdomain") return;
  const text = `${row.hostname} is live. Visitors there now see ${rows[0].name ?? "your workspace"}'s public pages over HTTPS.\n\nManage it: ${appUrl(`/w/${row.workspace_id}/settings/domains`)}`;
  await sendMail({
    to: rows[0].email,
    subject: `${row.hostname} is live on EveryOps`,
    text,
    html: text.replaceAll("\n", "<br>"),
  }).catch(() => false);
}

/** The cron job's pass: domains still on their way to live, checked again (a few per run). */
export async function checkPendingDomains(limit = 20) {
  const { rows } = await sql<{
    workspace_id: string;
    hostname: string;
  }>`select workspace_id, hostname from workspace_domain
    where status in ('pending', 'verifying', 'issuing') and kind = 'custom' and created_at > now() - interval '14 days'
    order by checked_at nulls first limit ${limit}`.execute(db);
  for (const r of rows) await checkDomain(r.workspace_id, r.hostname).catch(() => null);
  return rows.length;
}
