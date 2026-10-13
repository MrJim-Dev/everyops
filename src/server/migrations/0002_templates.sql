-- Built-in starter templates: the official community systems and the demo workspaces.
alter table published_system alter column author_id drop not null;
alter table published_system add column if not exists is_official boolean not null default false;

create table if not exists workspace_template (
  id text primary key,
  name text not null,
  summary text not null,
  source_system_id text,
  -- { blueprint, records, builtOn }: sample data and the day it was built.
  doc jsonb not null,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);
