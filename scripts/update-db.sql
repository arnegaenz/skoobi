-- Update status check constraint to support new pipeline statuses
alter table emails drop constraint if exists emails_status_check;
alter table emails add constraint emails_status_check
  check (status in ('unread', 'needs_reply', 'handled', 'sent', 'spam'));
