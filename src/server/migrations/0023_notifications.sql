-- In-app notifications: what automations tell the people in a workspace (a new booking for the owner, a job assigned
-- to staff). One row per person; read_at is set when they've seen it. Removed with the workspace or the person.
create table if not exists notification (
  id bigserial primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  title text not null,
  body text,
  record_id text,
  rule_id text,
  rule_name text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notification_user_idx on notification (user_id, workspace_id, created_at desc);

