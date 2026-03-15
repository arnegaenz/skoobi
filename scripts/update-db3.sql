-- Add app_tag column for multi-app email tagging
-- Values: hearz, connections_helper, skoobi, skoobilabs, unknown
-- Run in Supabase SQL Editor
ALTER TABLE emails ADD COLUMN app_tag TEXT DEFAULT 'unknown';
