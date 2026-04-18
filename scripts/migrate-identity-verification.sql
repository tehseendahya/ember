-- Migration for identity-verification fields on contacts.
-- Lets the sync pipeline record evidence, uncertainty, and candidate LinkedIn
-- profiles instead of silently inventing "Unknown" data.
-- Run in Supabase SQL editor.

begin;

alter table public.contacts
  add column if not exists needs_verification boolean not null default false;

alter table public.contacts
  add column if not exists verification_reason text not null default '';

-- Candidate profiles surfaced during enrichment the user can pick from.
-- Shape: [{ name, linkedin, title, snippet, sourceUrl, score }]
alter table public.contacts
  add column if not exists verification_candidates jsonb not null default '[]'::jsonb;

-- Signals we used to resolve identity (displayName, emailLocal, emailDomain, titleHint, etc.)
-- Shape: { primaryNameSource, hasDisplayName, hasWorkDomain, domainCompany, titleHint, confidence }
alter table public.contacts
  add column if not exists identity_evidence jsonb not null default '{}'::jsonb;

-- The calendar event id that first created this contact (for traceability + re-sync).
alter table public.contacts
  add column if not exists origin_event_id text;

create index if not exists contacts_needs_verification_idx
  on public.contacts(user_id, needs_verification)
  where needs_verification = true;

commit;
