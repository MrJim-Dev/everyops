-- Workspace assistant conversations, kept per person and workspace so people can go back to an earlier thread.
create table if not exists assistant_thread (
  id text primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  title text not null default '',
  turns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assistant_thread_owner on assistant_thread (workspace_id, user_id, updated_at desc);
