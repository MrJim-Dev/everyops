-- Requests AI agents leave through MCP's propose_change: a design change an agent can't make itself. Owners and
-- admins see them in History and draft them with Ask EveryOps, which shows the plan for approval as usual.
create table if not exists agent_request (
  id bigserial primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  key_id text,
  key_name text,
  request text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists agent_request_open on agent_request (workspace_id, created_at desc) where status = 'open';
