-- ============================================================
-- Ember Halo — Migration 003: n8n Workflow Support Columns
-- Adds columns needed by the 7 n8n automation workflows.
-- ============================================================

-- scheduling_records: post-service followup tracking (WF-07)
ALTER TABLE ember_halo.scheduling_records
  ADD COLUMN IF NOT EXISTS delivered_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS post_followup_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS post_followup_at   TIMESTAMPTZ;

-- Index for WF-07 daily scheduled scan (find delivered orders with no followup yet)
CREATE INDEX IF NOT EXISTS scheduling_followup_scan_idx
  ON ember_halo.scheduling_records(status, post_followup_sent)
  WHERE status = 'delivered' AND post_followup_sent = false;

-- conversations: needed by WF-05 inbound SMS for opt-out status
ALTER TABLE ember_halo.conversations
  ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN NOT NULL DEFAULT false;

-- notification_log: add conversation_id FK for WF traceability
ALTER TABLE ember_halo.notification_log
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES ember_halo.conversations(id);

CREATE INDEX IF NOT EXISTS notification_log_conversation_idx
  ON ember_halo.notification_log(conversation_id)
  WHERE conversation_id IS NOT NULL;
