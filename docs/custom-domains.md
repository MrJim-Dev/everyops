# Custom domains

Owners and admins put a workspace's public pages on their own address in Settings → Domains: `book.myresort.com` for the booking form, `myresort.com` for the site. Up to 3 custom domains per workspace; sign-in and the app stay on everyops.app (custom domains never receive session cookies).

## Routing (`src/proxy.ts`, `routeCustomHost` in `src/lib/domains.ts`)

- EveryOps' own hosts (everyops.app, www, *.run.app, localhost, BETTER_AUTH_URL) behave as before. A workspace's old `/s/<workspace>/…` address redirects (308) to its **primary** live domain.
- A live custom host serves only its workspace's public pages at clean paths: `/` is the home or the page the domain shows, `/rooms` is that page, and the app's own `/s/<workspace>/…` links redirect to the clean path. Next.js assets, `/b/<token>` booking links and `/api/public/<this workspace>/…` pass through; `/api/public/<another workspace>`, the app, sign-in, other workspaces and unknown hosts are a plain 404.
- Pages rendered for a custom host get `x-everyops-domain` and write clean links (`publicHref`, `withSiteLinks(html, slug, true)`), so a custom HTML site's "Book now" stays on the domain.
- Lookups are cached 10 s per instance (the proxy has its own copy), so a removed domain stops serving within 10 s.

## Setup and status (`src/server/domains.ts`)

Waiting for DNS → Verifying → Issuing certificate → Live, checked by "Check now" and the 15-minute cron job, with the owner emailed when a domain goes live. `diagnose` explains wrong DNS (an A record where a CNAME belongs, a CNAME to another service such as ghs.googlehosted.com, stray A records on an apex) and CAA records that block Google. Subdomains need a CNAME to `DOMAINS_CNAME_TARGET`; apex domains need A/AAAA records to the load balancer.

- **Claims.** Rows are per (workspace, hostname); only one can be live (`workspace_domain_live`). A hostname another workspace already claimed needs a TXT record `_everyops.<host>` = the shown token; proving it moves the domain.
- **Certificates.** With `DOMAINS_CERT_MAP` set, a DNS authorization (its `_acme-challenge` CNAME is shown with the other records), a Google-managed certificate and a certificate map entry are created per hostname, and deleted when the domain is removed. Removing warns if DNS still points at us.
- **Local checks.** Outside production, `*.localhost` hostnames go live at once (browsers resolve them to 127.0.0.1), e.g. `http://book.myresort.localhost:3000/`. Production ignores them, since development shares the database.

## Platform (once)

`scripts/setup-custom-domains.sh` creates the global external Application Load Balancer, serverless NEG for everyops-web, certificate map, HTTP→HTTPS redirect, and gives `everyops-run` the Certificate Manager role, then prints the DNS records and env (`DOMAINS_LB_IPV4`, `DOMAINS_CNAME_TARGET`, `DOMAINS_CERT_MAP`). Until those are set, DNS checks work and domains stop at Verifying. Phase 2 (the staff app on `app.<domain>`) is not built.
