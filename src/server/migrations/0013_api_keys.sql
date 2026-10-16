-- API keys: an account's keys for scripts, integrations and agents (the REST API and MCP). Only a SHA-256 hash of the
-- secret is kept. A key reaches every workspace the account can open, or only the listed ones, and never more than
-- its owner's current role in each; expired and revoked keys stop at once.
create table if not exists api_key (
  id text primary key,
  user_id text not null references "user"(id) on delete cascade,
  name text not null,
  prefix text not null,
  hash text not null unique,
  workspaces text[],
  permissions text[] not null,
  expires_at timestamptz,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_key_user on api_key (user_id, created_at desc);
