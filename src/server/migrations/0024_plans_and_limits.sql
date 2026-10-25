-- Plans, usage limits and billing (docs/billing.md).

-- One row per account that has been given a plan (no row = the default: Free, or Internal for site admins and
-- Demo for the shared demo account). Payment provider references stay empty until a provider is connected.
create table if not exists account_plan (
  user_id text primary key references "user"(id) on delete cascade,
  plan text not null default 'free',
  -- active | past_due | canceled; past_due keeps the plan through the grace period.
  status text not null default 'active',
  -- Extra AI credits for bonus_month only (an admin grant or a credit pack).
  bonus_credits integer not null default 0,
  bonus_month date,
  suspended_at timestamptz,
  suspended_reason text,
  current_period_end timestamptz,
  provider text,
  provider_customer text,
  provider_subscription text,
  note text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Everything that happened to an account's plan: assigned, credits granted, suspended, an upgrade asked for,
-- a payment received. Also the once-a-day marker for the AI safety switch (user_id null).
create table if not exists billing_event (
  id bigserial primary key,
  user_id text references "user"(id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  actor text,
  at timestamptz not null default now()
);
create index if not exists billing_event_user on billing_event (user_id, at desc);
create unique index if not exists billing_event_once_a_day on billing_event (kind, (detail->>'day'))
  where user_id is null;

-- Who pays for each Gemini call: the workspace's owner, or the person for setup and voice before a workspace.
alter table ai_call add column if not exists billed_to text;
update ai_call c set billed_to = coalesce((select w.owner_id from workspace w where w.id = c.workspace_id), c.user_id)
  where billed_to is null;
create index if not exists ai_call_billed on ai_call (billed_to, at desc) where billed_to is not null;

-- The starter workspaces every new account gets don't count toward the plan's workspaces.
alter table workspace add column if not exists starter boolean not null default false;
update workspace w set starter = true from account_seed s
  where s.user_id = w.owner_id and abs(extract(epoch from w.created_at - s.seeded_at)) < 120;

-- Files uploaded, so storage can be counted per account without listing the bucket.
create table if not exists file_upload (
  name text primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  bytes bigint not null,
  at timestamptz not null default now()
);
create index if not exists file_upload_workspace on file_upload (workspace_id);

