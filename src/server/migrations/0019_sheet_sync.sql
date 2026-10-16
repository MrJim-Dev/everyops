-- Google Sheets sync: a record type kept up to date from a sheet shared as "Anyone with the link". Every 15 minutes
-- the cron job reads it and, like an import, adds new rows and updates the ones that match (by match_field_id). Rows
-- removed from the sheet stay. One sync per record type.
create table if not exists sheet_sync (
  id text primary key,
  workspace_id text not null references workspace (id) on delete cascade,
  entity_id text not null,
  url text not null,
  mapping jsonb not null,
  match_field_id text not null,
  defaults jsonb not null default '{}',
  create_linked boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  last_result jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, entity_id)
);
