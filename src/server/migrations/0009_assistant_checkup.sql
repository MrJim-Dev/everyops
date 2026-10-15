-- The last "Things to fix" check per workspace: findings plus the key (blueprint version and memory update) they were
-- worked out for, so opening the assistant doesn't run a new check until the design or the memory changes.
alter table workspace_memory add column if not exists checkup jsonb;
