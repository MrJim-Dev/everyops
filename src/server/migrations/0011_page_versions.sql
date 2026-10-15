-- Earlier text of a workspace's pages (custom HTML, documents, canvas JSON). A save keeps the text it replaces when
-- the newest kept version is a few minutes old, so autosave doesn't keep every keystroke; the last 20 per page stay.
create table if not exists workspace_page_version (
  id bigserial primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  key text not null,
  body text not null,
  saved_at timestamptz not null,
  kept_at timestamptz not null default now()
);
create index if not exists workspace_page_version_key on workspace_page_version (workspace_id, key, kept_at desc);
