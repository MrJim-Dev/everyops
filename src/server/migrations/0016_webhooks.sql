-- Webhooks: endpoints owners and admins add in workspace settings, and an outbox of deliveries written in the same
-- transaction as the change that caused them (so no event is lost), sent right after the commit and retried with
-- backoff for up to 24 hours by the cron job.
create table if not exists webhook_endpoint (
  id text primary key,
  workspace_id text not null references workspace (id) on delete cascade,
  url text not null,
  description text,
  secret text not null,
  events text[] not null,
  entity_ids text[],
  enabled boolean not null default true,
  disabled_reason text,
  failures integer not null default 0,
  last_success_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists webhook_endpoint_workspace on webhook_endpoint (workspace_id) where enabled;

create table if not exists webhook_delivery (
  id bigserial primary key,
  endpoint_id text not null references webhook_endpoint (id) on delete cascade,
  workspace_id text not null references workspace (id) on delete cascade,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_status integer,
  last_error text,
  last_duration_ms integer,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists webhook_delivery_due on webhook_delivery (next_attempt_at) where status in ('pending', 'sending');
create index if not exists webhook_delivery_endpoint on webhook_delivery (endpoint_id, created_at desc);
