-- AI use per workspace (or per account, for setup before a workspace exists) and month: Gemini tokens (prompt,
-- answer and thinking) and requests, so owners can see what Ask EveryOps uses and an optional monthly budget holds.
create table if not exists ai_usage (
  scope text not null,
  month date not null,
  tokens bigint not null default 0,
  requests int not null default 0,
  primary key (scope, month)
);
