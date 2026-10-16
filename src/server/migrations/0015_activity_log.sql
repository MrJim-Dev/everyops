-- Who or what did each thing in a workspace: people in the app, API keys, MCP clients, automations, public forms
-- and booking links. Written in the same transaction as the change it describes; denied key requests too. Kept for
-- 180 days (the cron job trims older rows). Key events that aren't about one workspace (a key made or revoked, a key
-- used on a workspace it can't reach) have no workspace and show on the account page.
create table if not exists activity_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  workspace_id text references workspace (id) on delete cascade,
  actor_type text not null,
  actor_id text,
  actor_name text,
  user_id text,
  key_id text,
  action text not null,
  target text,
  ids text[] not null default '{}',
  count integer not null default 0,
  result text not null default 'ok',
  detail text,
  ip text,
  user_agent text
);

create index if not exists activity_log_workspace on activity_log (workspace_id, at desc, id desc);
create index if not exists activity_log_key on activity_log (key_id, at desc) where key_id is not null;
create index if not exists activity_log_user on activity_log (user_id, at desc) where workspace_id is null;
create index if not exists activity_log_at on activity_log (at);
