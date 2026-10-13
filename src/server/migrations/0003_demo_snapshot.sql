-- The curated state of the shared demo account's workspaces. The nightly reset restores these.
create table if not exists demo_snapshot (
  workspace_id text primary key,
  doc jsonb not null,
  taken_at timestamptz not null default now()
);
