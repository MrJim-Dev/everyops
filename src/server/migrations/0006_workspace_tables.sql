-- Workspace data moves out of the one workspace.doc JSON document into its own tables, so a change to one record
-- writes one row, the workspace list doesn't read every record, and the assistant can query records in SQL.
-- workspace.doc keeps only the workspace's own settings (name, summary, current version, source, setup).

create table if not exists workspace_record (
  workspace_id text not null references workspace(id) on delete cascade,
  id text not null,
  entity_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  -- Bumped on every write; a save names the rev it started from, and a different one is a conflict.
  rev integer not null default 1,
  -- Server time of the last write, so an open tab can fetch only what changed since it last looked.
  changed_at timestamptz not null default now(),
  -- Insert order: records keep the order they were added in (many seeded records share one created_at).
  seq bigserial,
  primary key (workspace_id, id)
);
create index if not exists workspace_record_entity_idx on workspace_record (workspace_id, entity_id, created_at);
create index if not exists workspace_record_changed_idx on workspace_record (workspace_id, changed_at);

-- Records deleted recently, so an open tab can drop them without reading every id. Kept for 30 days.
create table if not exists workspace_record_deleted (
  workspace_id text not null references workspace(id) on delete cascade,
  id text not null,
  deleted_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists workspace_record_deleted_at_idx on workspace_record_deleted (workspace_id, deleted_at);

-- Every blueprint version; version n is what workspace.doc.currentVersion = n points at.
create table if not exists workspace_version (
  workspace_id text not null references workspace(id) on delete cascade,
  version integer not null,
  blueprint jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, version)
);

-- The change history, newest first by applied_at.
create table if not exists workspace_change (
  workspace_id text not null references workspace(id) on delete cascade,
  id text not null,
  applied_at timestamptz not null,
  entry jsonb not null,
  primary key (workspace_id, id)
);
create index if not exists workspace_change_order_idx on workspace_change (workspace_id, applied_at desc);

-- Text of document, canvas and HTML pages (and HTML blocks), by view or block key.
create table if not exists workspace_page (
  workspace_id text not null references workspace(id) on delete cascade,
  key text not null,
  body text not null,
  updated_at timestamptz not null,
  primary key (workspace_id, key)
);

-- The documents exactly as they were before the split, so this can be rolled back. Drop it once the split is settled.
create table if not exists workspace_doc_archive (
  workspace_id text primary key,
  doc jsonb not null,
  archived_at timestamptz not null default now()
);

insert into workspace_doc_archive (workspace_id, doc)
select id, doc from workspace where doc ? 'records' or doc ? 'versions'
on conflict (workspace_id) do nothing;

-- A timestamp from a document, or the fallback when it's missing or not a date.
create or replace function pg_temp.ts(value text, fallback timestamptz) returns timestamptz
language plpgsql as $$
begin
  return coalesce(value::timestamptz, fallback);
exception when others then
  return fallback;
end $$;

insert into workspace_record (workspace_id, id, entity_id, data, created_at, updated_at)
select w.id, r->>'id', r->>'entityId', coalesce(r->'data', '{}'::jsonb),
  pg_temp.ts(r->>'createdAt', w.created_at), pg_temp.ts(r->>'updatedAt', pg_temp.ts(r->>'createdAt', w.created_at))
from workspace w, jsonb_array_elements(w.doc->'records') with ordinality as x(r, n)
where jsonb_typeof(w.doc->'records') = 'array' and r->>'id' is not null and r->>'entityId' is not null
order by w.id, x.n
on conflict (workspace_id, id) do nothing;

insert into workspace_version (workspace_id, version, blueprint)
select w.id, v.n::int, v.bp
from workspace w, jsonb_array_elements(w.doc->'versions') with ordinality as v(bp, n)
where jsonb_typeof(w.doc->'versions') = 'array'
on conflict (workspace_id, version) do nothing;

insert into workspace_change (workspace_id, id, applied_at, entry)
select w.id, c->>'id', pg_temp.ts(c->>'appliedAt', w.created_at), c
from workspace w, jsonb_array_elements(w.doc->'changes') c
where jsonb_typeof(w.doc->'changes') = 'array' and c->>'id' is not null
on conflict (workspace_id, id) do nothing;

insert into workspace_page (workspace_id, key, body, updated_at)
select w.id, d.key, coalesce(d.value->>'body', ''), pg_temp.ts(d.value->>'updatedAt', w.updated_at)
from workspace w, jsonb_each(w.doc->'docs') d
where jsonb_typeof(w.doc->'docs') = 'object'
on conflict (workspace_id, key) do nothing;

update workspace set doc = doc - 'records' - 'versions' - 'changes' - 'docs' - 'slug'
where doc ?| array['records', 'versions', 'changes', 'docs', 'slug'];

-- The demo snapshot keeps whole documents (records and all): it is read only by the nightly reset, which splits it.
