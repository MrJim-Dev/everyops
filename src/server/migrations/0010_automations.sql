-- What automations did: one row per automation that fired on a record (a save, a public booking, a schedule, a
-- date or Run now). Emails wait here as pending until the server sends them, so a mail outage retries instead of
-- losing them. run_key makes a timed automation run once per rule, record and day however often the runner checks.
create table if not exists automation_run (
  id bigserial primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  rule_id text not null,
  rule_name text not null,
  record_id text,
  record_label text,
  trigger text not null,
  run_key text,
  status text not null,
  detail text,
  emails jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists automation_run_key on automation_run (workspace_id, run_key) where run_key is not null;
create index if not exists automation_run_recent on automation_run (workspace_id, created_at desc);
create index if not exists automation_run_pending on automation_run (created_at) where status = 'pending';
