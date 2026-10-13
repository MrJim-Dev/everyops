-- Workspaces move from the browser into the database.
create table if not exists workspace (
  id text primary key,
  owner_id text not null references "user"(id) on delete cascade,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspace_owner_idx on workspace (owner_id);

create table if not exists workspace_member (
  workspace_id text not null references workspace(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  role text not null check (role in ('admin', 'staff', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_member_user_idx on workspace_member (user_id);

create table if not exists workspace_invite (
  token text primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'staff', 'viewer')),
  invited_by text not null,
  invited_at timestamptz not null default now()
);
create index if not exists workspace_invite_workspace_idx on workspace_invite (workspace_id);

create table if not exists published_system (
  id text primary key,
  author_id text not null references "user"(id) on delete cascade,
  source_workspace_id text references workspace(id) on delete set null,
  doc jsonb not null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists published_system_source_idx on published_system (source_workspace_id);

-- Demo workspaces are created once per account, even if the owner later deletes them.
create table if not exists account_seed (
  user_id text primary key references "user"(id) on delete cascade,
  seeded_at timestamptz not null default now()
);
