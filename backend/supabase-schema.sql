create table if not exists public.xcapital_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  plan text not null default 'Free',
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  purpose text not null,
  code text not null,
  used boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists idx_email_otps_lookup
  on public.email_otps (email, purpose, code, used, expires_at);

create table if not exists public.signal_usage (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  usage_date date not null,
  count integer not null default 0,
  last_used_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (email, usage_date)
);

create index if not exists idx_signal_usage_email_date
  on public.signal_usage (email, usage_date);

alter table public.xcapital_users enable row level security;
alter table public.email_otps enable row level security;
alter table public.signal_usage enable row level security;

drop policy if exists "service_role_manage_xcapital_users" on public.xcapital_users;
create policy "service_role_manage_xcapital_users"
  on public.xcapital_users
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_manage_email_otps" on public.email_otps;
create policy "service_role_manage_email_otps"
  on public.email_otps
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_manage_signal_usage" on public.signal_usage;
create policy "service_role_manage_signal_usage"
  on public.signal_usage
  for all
  to service_role
  using (true)
  with check (true);
