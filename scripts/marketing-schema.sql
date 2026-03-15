-- SkoobiLabs Marketing Engine — Supabase Schema
-- Run this in the Supabase SQL Editor
-- Created: 2026-03-15

-- ═══════════════════════════════════════════════
-- 1. CAMPAIGNS
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_tag TEXT NOT NULL CHECK (app_tag IN ('hearz', 'connections_helper', 'skoobi', 'skoobilabs')),
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'google', 'apple_search', 'tiktok', 'manual')),
  campaign_name TEXT NOT NULL,
  campaign_external_id TEXT,
  creative_type TEXT CHECK (creative_type IN ('image', 'video', 'text', 'carousel')),
  target_audience TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  budget_cents INTEGER NOT NULL DEFAULT 0,
  daily_budget_cents INTEGER,
  start_date DATE,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_app_tag ON marketing_campaigns (app_tag);
CREATE INDEX idx_campaigns_platform ON marketing_campaigns (platform);
CREATE INDEX idx_campaigns_status ON marketing_campaigns (status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_marketing_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON marketing_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_marketing_campaigns_updated_at();

-- ═══════════════════════════════════════════════
-- 2. DAILY METRICS (per campaign, per day)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS marketing_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0,
  signups INTEGER NOT NULL DEFAULT 0,
  subscriptions INTEGER NOT NULL DEFAULT 0,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  spend_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, date)
);

CREATE INDEX idx_daily_metrics_campaign ON marketing_daily_metrics (campaign_id);
CREATE INDEX idx_daily_metrics_date ON marketing_daily_metrics (date);

-- ═══════════════════════════════════════════════
-- 3. ATTRIBUTIONS (link installs/signups to campaigns)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS marketing_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  app_tag TEXT NOT NULL,
  referral_code TEXT,
  device_id TEXT,
  user_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('install', 'signup', 'trial_start', 'subscription', 'cancellation', 'feedback_email')),
  event_metadata JSONB,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attributions_campaign ON marketing_attributions (campaign_id);
CREATE INDEX idx_attributions_app ON marketing_attributions (app_tag);
CREATE INDEX idx_attributions_referral ON marketing_attributions (referral_code);
CREATE INDEX idx_attributions_event ON marketing_attributions (event_type);
CREATE INDEX idx_attributions_date ON marketing_attributions (attributed_at);

-- ═══════════════════════════════════════════════
-- 4. AI INSIGHTS (generated analysis & recommendations)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS marketing_ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_date DATE NOT NULL,
  app_tag TEXT,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('performance_review', 'budget_recommendation', 'creative_suggestion', 'audience_insight', 'weekly_report')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  recommendations JSONB,
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_insights_date ON marketing_ai_insights (analysis_date);
CREATE INDEX idx_insights_app ON marketing_ai_insights (app_tag);
CREATE INDEX idx_insights_type ON marketing_ai_insights (insight_type);

-- ═══════════════════════════════════════════════
-- 5. CREATIVES (ad copy, images, variants)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS marketing_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  app_tag TEXT NOT NULL,
  creative_type TEXT NOT NULL CHECK (creative_type IN ('headline', 'body_copy', 'image_url', 'video_url')),
  content TEXT NOT NULL,
  variant_label TEXT,
  performance_score REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_creatives_campaign ON marketing_creatives (campaign_id);
CREATE INDEX idx_creatives_app ON marketing_creatives (app_tag);

-- ═══════════════════════════════════════════════
-- RLS POLICIES (service_role full access)
-- ═══════════════════════════════════════════════
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_creatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON marketing_campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON marketing_daily_metrics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON marketing_attributions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON marketing_ai_insights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON marketing_creatives FOR ALL USING (true) WITH CHECK (true);
