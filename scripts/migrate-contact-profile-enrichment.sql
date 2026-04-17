-- Migration for contact profile enrichment fields and manual-lock persistence.
-- Run in Supabase SQL editor before using the new profile enrichment features.

begin;

alter table public.contacts
  add column if not exists school text not null default '';

alter table public.contacts
  add column if not exists location text not null default '';

alter table public.contacts
  add column if not exists bio text not null default '';

alter table public.contacts
  add column if not exists profile_source text not null default 'manual';

alter table public.contacts
  add column if not exists profile_confidence smallint not null default 0;

alter table public.contacts
  add column if not exists profile_source_urls text[] not null default '{}';

alter table public.contacts
  add column if not exists locked_fields text[] not null default '{}';

alter table public.contacts
  drop constraint if exists contacts_profile_confidence_check;

alter table public.contacts
  add constraint contacts_profile_confidence_check
  check (profile_confidence between 0 and 100);

commit;
