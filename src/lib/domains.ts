/**
 * Custom domains: which hostnames a workspace may claim, the DNS records they need, what DNS answers mean, and how a
 * request on a custom host maps onto the workspace's public pages. Pure, so it's tested; the table, DNS lookups and
 * certificates are in src/server/domains.ts and routing in src/proxy.ts.
 */

/** Where subdomains point (CNAME) and, for apex domains, the load balancer's addresses (A / AAAA). */
export type DnsTargets = { cname: string; ipv4: string[]; ipv6: string[] };

/** Our own hosts: the app itself. Everything else is either a claimed custom domain or nothing. */
export const APP_DOMAIN = "everyops.app";

/** Second-level suffixes where the registrable (apex) domain has three labels, e.g. resort.com.ph. */
const TWO_LEVEL = new Set([
  "com.ph",
  "net.ph",
  "org.ph",
  "edu.ph",
  "gov.ph",
  "co.uk",
  "org.uk",
  "com.au",
  "net.au",
  "co.nz",
  "com.sg",
  "com.my",
  "co.jp",
  "co.id",
  "com.hk",
]);

/** A hostname as typed ("https://Book.MyResort.com/") made canonical, or why it can't be used. */
export function parseHostname(input: string): { ok: true; host: string } | { ok: false; message: string } {
  const raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, message: "Enter a domain, like book.myresort.com." };
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return { ok: false, message: "That isn't a domain name." };
  }
  host = host.replace(/\.$/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":"))
    return { ok: false, message: "Use a domain name, not an IP address." };
  const labels = host.split(".");
  if (
    labels.length < 2 ||
    labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) ||
    host.length > 253
  )
    return { ok: false, message: "That isn't a valid domain name." };
  if (host === APP_DOMAIN || host.endsWith(`.${APP_DOMAIN}`))
    return {
      ok: false,
      message: "Use a domain you own; everyops.app addresses can't be added.",
    };
  if (
    /\.(local|localhost|internal|test|example|invalid)$/.test(host) &&
    process.env.NODE_ENV === "production"
  )
    return { ok: false, message: "That domain can't be reached on the internet." };
  return { ok: true, host };
}

/** Whether a host is a registrable (apex) domain, which can't take a CNAME and needs A/AAAA records instead. */
export function isApex(host: string): boolean {
  const labels = host.split(".");
  return labels.length === 2 || (labels.length === 3 && TWO_LEVEL.has(labels.slice(1).join(".")));
}

export type DnsRecord = { type: "CNAME" | "A" | "AAAA" | "TXT"; name: string; value: string; why: string };

/** The records an owner adds at their DNS provider. */
export function recordsFor(
  host: string,
  targets: DnsTargets,
  extra: { acme?: string; ownership?: string } = {},
): DnsRecord[] {
  const out: DnsRecord[] = isApex(host)
    ? [
        ...targets.ipv4.map((ip) => ({
          type: "A" as const,
          name: host,
          value: ip,
          why: "Sends visitors to EveryOps",
        })),
        ...targets.ipv6.map((ip) => ({
          type: "AAAA" as const,
          name: host,
          value: ip,
          why: "The same, over IPv6",
        })),
      ]
    : [{ type: "CNAME", name: host, value: targets.cname, why: "Sends visitors to EveryOps" }];
  if (extra.acme)
    out.push({
      type: "CNAME",
      name: `_acme-challenge.${host}`,
      value: extra.acme,
      why: "Lets Google issue the HTTPS certificate",
    });
  if (extra.ownership)
    out.push({
      type: "TXT",
      name: `_everyops.${host}`,
      value: extra.ownership,
      why: "Proves you own the domain",
    });
  return out;
}

export type DnsAnswers = {
  cname: string[];
  a: string[];
  aaaa: string[];
  caa: { tag: string; value: string }[];
  txt?: string[];
};

const clean = (s: string) => s.toLowerCase().replace(/\.$/, "");

/** Certificate authorities Google-managed certificates come from; a CAA record must allow one of them. */
const GOOGLE_CAS = ["pki.goog", "letsencrypt.org"];

/** Whether CAA records forbid Google from issuing a certificate for the host. */
export function caaBlocks(caa: { tag: string; value: string }[]): boolean {
  const issue = caa.filter((r) => r.tag === "issue" || r.tag === "issuewild");
  return (
    issue.length > 0 &&
    !issue.some((r) => GOOGLE_CAS.some((ca) => clean(r.value).split(";")[0].trim() === ca))
  );
}

/**
 * What the DNS answers mean for a domain: "ok" when it points at us, "waiting" when nothing points anywhere yet, or
 * "wrong" with a plain reason (another service's CNAME, the wrong IP, a CAA record that blocks Google).
 */
export function diagnose(
  host: string,
  answers: DnsAnswers,
  targets: DnsTargets,
  ownership?: string,
): { state: "ok" | "waiting" | "wrong"; message: string } {
  if (caaBlocks(answers.caa))
    return {
      state: "wrong",
      message: `A CAA record on ${host} blocks Google from issuing the certificate. Add a CAA record allowing pki.goog, or remove the CAA records.`,
    };
  if (ownership && !(answers.txt ?? []).some((t) => t.trim() === ownership))
    return {
      state: "waiting",
      message: `Add the TXT record _everyops.${host} to prove you own it; another workspace claimed it before.`,
    };
  if (isApex(host)) {
    if (answers.cname.length)
      return {
        state: "wrong",
        message: `${host} is a CNAME to ${clean(answers.cname[0])}. Apex domains need A records to ${targets.ipv4.join(", ")}.`,
      };
    const want = new Set(targets.ipv4);
    if (!answers.a.length && !answers.aaaa.length)
      return { state: "waiting", message: "Waiting for DNS: no A record yet." };
    const stray = answers.a.filter((ip) => !want.has(ip));
    if (stray.length)
      return {
        state: "wrong",
        message: `${host} points to ${stray.join(", ")}. Change its A record to ${targets.ipv4.join(", ")} and remove the others.`,
      };
    return { state: "ok", message: "DNS points to EveryOps." };
  }
  const cname = answers.cname.map(clean);
  if (!cname.length)
    return answers.a.length
      ? {
          state: "wrong",
          message: `${host} has an A record (${answers.a[0]}). Replace it with a CNAME to ${targets.cname}.`,
        }
      : { state: "waiting", message: "Waiting for DNS: no CNAME record yet." };
  if (cname[0] !== clean(targets.cname)) {
    const known = cname[0] === "ghs.googlehosted.com" ? " (that's Google Sites / App Engine)" : "";
    return { state: "wrong", message: `CNAME points to ${cname[0]}${known}. Change it to ${targets.cname}.` };
  }
  return { state: "ok", message: "DNS points to EveryOps." };
}

/** What a domain serves: the workspace's public home, or one public page as its root. */
export type DomainRoute = { workspaceId: string; target: string };

/** Paths a custom domain hands to the app as they are: Next.js assets and the public API. */
const PASS =
  /^\/(_next\/|api\/public\/|favicon\.ico$|icon\.svg$|apple-icon\.png$|robots\.txt$|manifest\.webmanifest$|b\/)/;

/**
 * How a request on a custom domain is served. "/" is the home (or the chosen page), "/rooms" is that page, links the
 * app writes as /s/<workspace>/… redirect to the clean path, and anything else (another workspace, the app, sign-in)
 * is not found: a custom domain only ever shows its own workspace's public pages.
 */
export function routeCustomHost(
  path: string,
  domain: DomainRoute,
):
  | { kind: "pass" }
  | { kind: "rewrite"; to: string }
  | { kind: "redirect"; to: string }
  | { kind: "notFound" } {
  // The public API answers for this workspace only (booking links carry their own signed token).
  const api = /^\/api\/public\/([^/]+)\//.exec(path);
  if (api && api[1] !== domain.workspaceId && api[1] !== "booking") return { kind: "notFound" };
  if (PASS.test(path)) return { kind: "pass" };
  const own = `/s/${domain.workspaceId}`;
  if (path === own || path.startsWith(`${own}/`))
    return { kind: "redirect", to: path.slice(own.length) || "/" };
  if (
    /^\/(s|w|api|account|workspaces|sign-in|sign-up|welcome|community|preview|terms|privacy|developers|mcp)(\/|$)/.test(
      path,
    )
  )
    return { kind: "notFound" };
  const segments = path.split("/").filter(Boolean);
  if (segments.length > 2 || segments.some((s) => s.startsWith("."))) return { kind: "notFound" };
  if (!segments.length)
    return { kind: "rewrite", to: domain.target === "home" ? own : `${own}/${domain.target}` };
  return { kind: "rewrite", to: `${own}/${segments.join("/")}` };
}

/** A public page's address: /s/<workspace>/<page> on EveryOps, or /<page> on the workspace's own domain. */
export function publicHref(slug: string, viewId: string | undefined, onCustomDomain: boolean): string {
  if (onCustomDomain) return viewId ? `/${viewId}` : "/";
  return viewId ? `/s/${slug}/${viewId}` : `/s/${slug}`;
}
