-- What Ask EveryOps remembers about a workspace's business: the owner's standing instructions and short notes
-- (business facts, preferences, goals) from setup, conversations and the owner. Its own row, so notes the assistant
-- adds after a conversation never race the browser's settings saves on workspace.doc.
create table if not exists workspace_memory (
  workspace_id text primary key references workspace(id) on delete cascade,
  instructions text not null default '',
  notes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
