-- Per-account AI request counts in 10-minute windows, shared by every Cloud Run instance (src/server/ai/rate-limit.ts).
create table if not exists ai_rate_limit (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
create index if not exists ai_rate_limit_window_start on ai_rate_limit (window_start);
