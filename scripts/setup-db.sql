-- Email pipeline table for ask@skoobilabs.com
create table if not exists emails (
  id uuid default gen_random_uuid() primary key,
  from_email text not null,
  from_name text,
  subject text,
  body_text text,
  received_at timestamptz not null default now(),
  status text not null default 'unread' check (status in ('unread', 'triaged', 'responded', 'archived')),
  category text check (category in ('bug', 'feature_request', 'support', 'praise', 'question', 'other')),
  aurora_notes text,
  aurora_draft_response text,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table emails enable row level security;

-- Policy: service role can do everything (our backend)
create policy "Service role full access" on emails
  for all using (true) with check (true);

-- Index for quick status lookups
create index idx_emails_status on emails (status);
create index idx_emails_received_at on emails (received_at desc);
