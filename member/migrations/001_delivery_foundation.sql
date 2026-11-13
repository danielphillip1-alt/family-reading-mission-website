-- DEVELOPMENT-ONLY migration proposal; does not touch existing members table.
-- Apply in a staging DB after review.
ALTER TABLE members ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en'
  CHECK (preferred_language IN ('en','de','pt-PT'));
CREATE TABLE IF NOT EXISTS aom_releases (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('draft','approved','published','withdrawn')),
  published_at timestamptz
);
CREATE TABLE IF NOT EXISTS aom_release_editions (
  release_id uuid NOT NULL REFERENCES aom_releases(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en','de','pt-PT')),
  private_object_key text NOT NULL,
  sha256 text NOT NULL,
  approved_at timestamptz,
  PRIMARY KEY (release_id, language)
);
CREATE TABLE IF NOT EXISTS aom_delivery_outbox (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES aom_releases(id),
  member_id uuid NOT NULL REFERENCES members(id),
  kind text NOT NULL CHECK (kind IN ('welcome','release')),
  language text NOT NULL CHECK (language IN ('en','de','pt-PT')),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processing','sent','retry','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  UNIQUE (release_id, member_id, kind)
);
CREATE INDEX IF NOT EXISTS aom_delivery_pending_idx
  ON aom_delivery_outbox (state,next_attempt_at);
CREATE TABLE IF NOT EXISTS aom_stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
