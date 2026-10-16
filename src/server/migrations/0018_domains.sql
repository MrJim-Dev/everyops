-- Custom domains: hostnames a workspace serves its public pages on (book.myresort.com) and free subdomains
-- (myresort.everyops.app). A hostname can be live for one workspace only; a later claim must prove ownership with a
-- TXT record. Certificates come from Certificate Manager (ids kept here so removing a domain deletes them).
create table if not exists workspace_domain (
  workspace_id text not null references workspace (id) on delete cascade,
  hostname text not null,
  target text not null default 'home',
  kind text not null default 'custom',
  status text not null default 'pending',
  message text,
  ownership_token text,
  acme_name text,
  acme_value text,
  dns_authorization text,
  certificate text,
  map_entry text,
  is_primary boolean not null default false,
  checked_at timestamptz,
  live_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, hostname)
);
create unique index if not exists workspace_domain_live on workspace_domain (hostname) where status = 'live';
create index if not exists workspace_domain_host on workspace_domain (hostname);
