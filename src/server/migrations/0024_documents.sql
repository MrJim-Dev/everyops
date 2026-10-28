-- Documents (docs/documents.md): every file a workspace keeps, listed from here without reading the bucket, and how
-- much room they take against the workspace's storage limit (src/server/storage-usage.ts). Written so the plans work
-- (its own file_upload, created if missing) can come after this without changing anything here.
create table if not exists file_upload (
  name text primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  bytes bigint not null,
  at timestamptz not null default now()
);
create index if not exists file_upload_workspace on file_upload (workspace_id);
alter table file_upload add column if not exists display_name text;
alter table file_upload add column if not exists content_type text;
alter table file_upload add column if not exists source text not null default 'record';
alter table file_upload add column if not exists folder text;
alter table file_upload add column if not exists added_by text;
alter table file_upload add column if not exists added_by_name text;
create index if not exists file_upload_workspace_at on file_upload (workspace_id, at desc);
