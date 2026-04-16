-- Extensions
create extension if not exists "pgcrypto";

-- Contacts
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text not null default '',
  company text not null default '',
  role text not null default '',
  linkedin text not null default '',
  avatar text not null default '',
  avatar_color text not null default '#6c63ff',
  tags text[] not null default '{}',
  last_contact_type text not null default 'message',
  last_contact_date date not null default current_date,
  last_contact_description text not null default 'Added to CRM',
  notes text not null default '',
  connection_strength smallint not null default 2 check (connection_strength between 1 and 5),
  mutual_connections text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_user_idx on public.contacts(user_id);
create index if not exists contacts_last_contact_idx on public.contacts(user_id, last_contact_date desc);

-- Interactions
create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  date date not null,
  type text not null,
  title text not null,
  notes text not null default '',
  reminder date,
  created_at timestamptz not null default now()
);

create index if not exists interactions_user_contact_idx on public.interactions(user_id, contact_id, date desc);
create index if not exists interactions_user_date_idx on public.interactions(user_id, date desc);

-- Reminders
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  date date not null,
  text text not null,
  done boolean not null default false,
  source text not null default 'manual',
  external_event_id text,
  external_url text,
  created_at timestamptz not null default now()
);

create index if not exists reminders_user_due_idx on public.reminders(user_id, done, date);
create index if not exists reminders_google_source_idx on public.reminders(user_id, source, external_event_id);

-- Recent updates log
create table if not exists public.recent_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  timestamp timestamptz not null default now(),
  input text not null,
  actions text[] not null default '{}'
);

create index if not exists recent_updates_user_time_idx on public.recent_updates(user_id, timestamp desc);

-- Snoozes
create table if not exists public.contact_snoozes (
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  snoozed_until date not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, contact_id)
);

create index if not exists contact_snoozes_user_idx on public.contact_snoozes(user_id, snoozed_until);

-- Second-degree relationship graph
create table if not exists public.second_degree_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  introducer_contact_id uuid not null references public.contacts(id) on delete cascade,
  target_name text not null,
  target_company text not null default '',
  target_role text not null default '',
  target_contact_id uuid references public.contacts(id) on delete set null,
  target_linkedin text,
  evidence text not null default 'other',
  confidence smallint not null default 3 check (confidence between 1 and 5),
  last_evidence_at date not null default current_date,
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create index if not exists second_degree_edges_user_intro_idx on public.second_degree_edges(user_id, introducer_contact_id);
create index if not exists second_degree_edges_user_target_idx on public.second_degree_edges(user_id, target_name);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
before update on public.contacts
for each row
execute function public.set_updated_at();

-- RLS
alter table public.contacts enable row level security;
alter table public.interactions enable row level security;
alter table public.reminders enable row level security;
alter table public.recent_updates enable row level security;
alter table public.contact_snoozes enable row level security;
alter table public.second_degree_edges enable row level security;

create policy "contacts own rows" on public.contacts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "interactions own rows" on public.interactions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "reminders own rows" on public.reminders
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "recent_updates own rows" on public.recent_updates
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "contact_snoozes own rows" on public.contact_snoozes
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "second_degree_edges own rows" on public.second_degree_edges
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
