-- Authors On A Mission delivery foundation, PostgreSQL 15+
-- Apply in an isolated test database after review. Never run against production implicitly.
create extension if not exists pgcrypto;

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_verified_at timestamptz,
  stripe_customer_id text unique,
  preferred_language text not null default 'en'
    check (preferred_language in ('en','de','pt-PT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists members_email_lower_unique on members (lower(email));

create table if not exists subscriptions (
  stripe_subscription_id text primary key,
  member_id uuid not null references members(id),
  stripe_price_id text not null,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_member_idx on subscriptions(member_id,status,current_period_end);

create table if not exists releases (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  published_at timestamptz,
  status text not null check (status in ('draft','approved','published','withdrawn')),
  created_at timestamptz not null default now()
);
create table if not exists release_editions (
  release_id uuid not null references releases(id) on delete cascade,
  language text not null check (language in ('en','de','pt-PT')),
  object_storage_key text not null,
  approved_at timestamptz,
  file_sha256 text not null,
  primary key (release_id,language)
);

create table if not exists stripe_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create table if not exists delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references releases(id),
  member_id uuid not null references members(id),
  kind text not null check (kind in ('welcome','release')),
  language text not null check (language in ('en','de','pt-PT')),
  state text not null default 'pending'
    check (state in ('pending','processing','sent','retry','failed','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (release_id,member_id,kind)
);
create index if not exists delivery_outbox_pending_idx on delivery_outbox(state,next_attempt_at);

-- Worker claim transaction:
-- SELECT id FROM delivery_outbox WHERE state IN ('pending','retry') AND
-- next_attempt_at <= now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100;
-- Then update claimed rows to processing. Recover stale processing rows.
-- Always recheck paid entitlement and approved language edition before dispatch.
