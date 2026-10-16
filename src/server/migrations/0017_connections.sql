-- Outside MCP servers connected to a workspace (Google Calendar, Gmail), with the connecting owner's or admin's
-- OAuth tokens sealed (src/server/secret-box.ts), and the outside writes Ask EveryOps proposed, which run only when an
-- owner or admin applies them.
create table if not exists workspace_connection (
  id text primary key,
  workspace_id text not null references workspace (id) on delete cascade,
  provider text not null,
  account_email text,
  access_token text,
  refresh_token text not null,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists connection_action (
  id bigserial primary key,
  workspace_id text not null references workspace (id) on delete cascade,
  provider text not null,
  tool text not null,
  args jsonb not null,
  summary text not null,
  status text not null default 'proposed',
  result text,
  proposed_by text,
  decided_by text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists connection_action_open on connection_action (workspace_id, created_at desc) where status = 'proposed';
