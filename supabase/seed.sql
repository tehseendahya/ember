-- Replace with an existing auth.users id from your project.
-- Example:
-- select id, email from auth.users;
-- Then set it below before running.
do $$
declare
  target_user_id uuid := '00000000-0000-0000-0000-000000000000';
  c_justin uuid := gen_random_uuid();
  c_sarah uuid := gen_random_uuid();
  c_michael uuid := gen_random_uuid();
  c_emily uuid := gen_random_uuid();
  c_ben uuid := gen_random_uuid();
begin
  if target_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Set target_user_id in supabase/seed.sql before running.';
  end if;

  insert into public.contacts (
    id, user_id, name, email, company, role, linkedin, avatar, avatar_color, tags,
    last_contact_type, last_contact_date, last_contact_description, notes, connection_strength, mutual_connections
  ) values
    (c_justin, target_user_id, 'Justin Smith', 'justin.smith@a16z.com', 'Andreessen Horowitz', 'Partner',
      'https://linkedin.com/in/justinsmith', 'JS', '#6c63ff', array['investor','warm','vc'],
      'meeting', '2026-01-15', 'Meeting in NYC, Jan 15',
      'Met at YC Demo Day 2024. Intro''d me to Nina Sharma at Sequoia.', 5, array[]::text[]),
    (c_sarah, target_user_id, 'Sarah Chen', 'sarah.chen@google.com', 'Google', 'Product Manager',
      'https://linkedin.com/in/sarahchen', 'SC', '#10b981', array['product','warm','tech'],
      'meeting', '2026-02-03', 'Coffee chat about AI products, Feb 3',
      'Stanford CS grad, strong enterprise AI product instincts.', 4, array[]::text[]),
    (c_michael, target_user_id, 'Michael Torres', 'michael@techstart.io', 'TechStart', 'Founder & CEO',
      'https://linkedin.com/in/michaeltorres', 'MT', '#f59e0b', array['founder','partnership','b2b'],
      'zoom', '2025-12-28', 'Zoom call re: partnership, Dec 28',
      'Raised $3M seed. Exploring integration partnership.', 3, array[]::text[]),
    (c_emily, target_user_id, 'Emily Rodriguez', 'emily.r@openai.com', 'OpenAI', 'ML Engineer',
      'https://linkedin.com/in/emilyrodriguez', 'ER', '#a78bfa', array['ai','engineer','research'],
      'email', '2026-03-01', 'Email about new paper, Mar 1',
      'PhD from MIT, works on safety and alignment.', 3, array[]::text[]),
    (c_ben, target_user_id, 'Ben Taylor', 'ben.t@notion.so', 'Notion', 'Chief Product Officer',
      'https://linkedin.com/in/bentaylor', 'BT', '#fbbf24', array['product','advisor','saas'],
      'zoom', '2026-03-10', 'Podcast interview, Mar 10',
      'Trusted advisor, introduced Rachel Kim.', 4, array[]::text[]);

  insert into public.interactions (user_id, contact_id, date, type, title, notes, reminder) values
    (target_user_id, c_justin, '2026-01-15', 'meeting', 'Meeting in NYC', 'Discussed AI infra market outlook.', '2026-04-01'),
    (target_user_id, c_sarah, '2026-02-03', 'meeting', 'Coffee chat about AI products', 'Shared enterprise AI adoption insights.', null),
    (target_user_id, c_michael, '2025-12-28', 'zoom', 'Partnership discussion', 'Deep dive on API integration opportunities.', '2026-01-15'),
    (target_user_id, c_emily, '2026-03-01', 'email', 'Discussion about new alignment paper', 'Great thread on constitutional AI methods.', null),
    (target_user_id, c_ben, '2026-03-10', 'zoom', 'Podcast recording', 'Episode on building for PLG.', null);

  insert into public.reminders (user_id, contact_id, date, text, done, source) values
    (target_user_id, c_justin, '2026-04-01', 'Q2 check-in after metrics update', false, 'manual'),
    (target_user_id, c_michael, '2026-01-15', 'Send partnership technical spec follow-up', true, 'manual'),
    (target_user_id, null, current_date + 3, 'Review stale contacts and schedule two reachouts', false, 'manual');

  insert into public.recent_updates (user_id, timestamp, input, actions) values
    (target_user_id, '2026-03-10T18:00:00Z', 'Wrapped podcast with Ben Taylor', array['Updated last contact for Ben Taylor','Logged podcast interaction']),
    (target_user_id, '2026-03-05T17:30:00Z', 'Zoom with Alex Johnson about SDK collab', array['Added interaction note','Created review reminder']),
    (target_user_id, '2026-02-27T14:15:00Z', 'Chris Martinez replied to outreach', array['Updated outreach status','Reminder to schedule call']);

  insert into public.contact_snoozes (user_id, contact_id, snoozed_until) values
    (target_user_id, c_emily, current_date + 10)
  on conflict (user_id, contact_id) do update set snoozed_until = excluded.snoozed_until;

  insert into public.second_degree_edges (
    user_id, introducer_contact_id, target_name, target_company, target_role, evidence, confidence, last_evidence_at, notes, source
  ) values
    (target_user_id, c_justin, 'Nina Sharma', 'Sequoia Capital', 'Partner', 'intro_offer', 5, '2026-01-15', 'Justin offered a warm intro after Q2 metrics.', 'import'),
    (target_user_id, c_sarah, 'Jeff Dean', 'Google DeepMind', 'Chief Scientist', 'colleague', 4, '2026-02-03', 'Sarah knows Jeff from internal PM/Research workstreams.', 'import'),
    (target_user_id, c_ben, 'Rachel Kim', 'Figma', 'Head of Design', 'friend', 4, '2026-03-10', 'Ben made a prior intro for design feedback.', 'import');
end $$;
