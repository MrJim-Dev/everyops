-- Every Gemini call EveryOps makes, one row each: who and what it was for (account, workspace, feature, step), the
-- model, how it ended (duplicates cancelled, loops stopped and failures included, since they're paid for too), its
-- tokens, an estimated cost and where it ran (production, a local dev server or a script). Settings show it per
-- workspace and per account; per-account limits will read it. No foreign keys: an account's history outlives a
-- deleted workspace, and a script's calls belong to no one.
create table if not exists ai_call (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id text,
  workspace_id text,
  request_id text,
  feature text not null,
  task text not null,
  model text not null,
  location text not null,
  attempt smallint not null default 0,
  rounds smallint not null default 1,
  outcome text not null,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  thinking_tokens integer not null default 0,
  estimated boolean not null default false,
  cost_micros bigint not null default 0,
  ms integer not null default 0,
  origin text not null
);
create index if not exists ai_call_workspace on ai_call (workspace_id, at desc) where workspace_id is not null;
create index if not exists ai_call_user on ai_call (user_id, at desc) where user_id is not null;
create index if not exists ai_call_at on ai_call (at desc);
