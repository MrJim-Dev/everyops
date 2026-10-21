-- Private beta waitlist: people who tried to create an account while PRIVATE_BETA_ENABLED was on and whose email
-- was not allowed yet. One row per email (stored lowercased); trying again only refreshes name and updated_at.
-- Approving someone means setting status to 'approved' (README, "Private beta"); they can then sign up.
-- No password or session is ever kept here.
create table if not exists waitlist (
  id text primary key,
  email text not null unique check (email = lower(email)),
  name text,
  source text not null check (source in ('email', 'google')),
  status text not null default 'waiting' check (status in ('waiting', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists waitlist_status on waitlist (status, created_at);
