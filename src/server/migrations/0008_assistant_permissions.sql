-- How much Ask EveryOps may do on its own in a workspace (autonomy level, ask before removals, learn from chat).
-- Empty means the defaults: ask for approval, confirm removals, learn.
alter table workspace_memory add column if not exists permissions jsonb not null default '{}'::jsonb;
