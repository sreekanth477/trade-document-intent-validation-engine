-- ============================================================
-- Trade Document Intent Validation Engine - Database Schema
-- PostgreSQL 14+
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM TYPES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE presentation_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('lc', 'invoice', 'bl', 'insurance', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE extraction_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finding_severity AS ENUM ('critical', 'moderate', 'informational');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finding_status AS ENUM ('open', 'accepted', 'overridden', 'escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE override_action AS ENUM ('accept', 'override', 'escalate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('checker', 'supervisor', 'compliance', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  full_name      VARCHAR(255) NOT NULL,
  role           user_role NOT NULL DEFAULT 'checker',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_active   ON users (is_active);

-- ============================================================
-- TABLE: lc_presentations
-- ============================================================
CREATE TABLE IF NOT EXISTS lc_presentations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lc_number          VARCHAR(100),
  client_name        VARCHAR(255),
  applicant          VARCHAR(255),
  beneficiary        VARCHAR(255),
  status             presentation_status NOT NULL DEFAULT 'pending',
  overall_risk_score INT CHECK (overall_risk_score BETWEEN 0 AND 100),
  stp_candidate      BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by       UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lc_presentations_status      ON lc_presentations (status);
CREATE INDEX IF NOT EXISTS idx_lc_presentations_lc_number   ON lc_presentations (lc_number);
CREATE INDEX IF NOT EXISTS idx_lc_presentations_created_at  ON lc_presentations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lc_presentations_submitted_by ON lc_presentations (submitted_by);

-- ============================================================
-- TABLE: documents
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id    UUID NOT NULL REFERENCES lc_presentations (id) ON DELETE CASCADE,
  document_type      document_type NOT NULL DEFAULT 'other',
  filename           VARCHAR(500) NOT NULL,
  original_name      VARCHAR(500) NOT NULL,
  file_path          TEXT NOT NULL,
  file_size_bytes    BIGINT,
  mime_type          VARCHAR(100),
  ocr_confidence     DECIMAL(5,4) CHECK (ocr_confidence BETWEEN 0 AND 1),
  extraction_status  extraction_status NOT NULL DEFAULT 'pending',
  extracted_data     JSONB,
  extraction_error   TEXT,
  page_count         INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_presentation_id    ON documents (presentation_id);
CREATE INDEX IF NOT EXISTS idx_documents_document_type      ON documents (document_type);
CREATE INDEX IF NOT EXISTS idx_documents_extraction_status  ON documents (extraction_status);
CREATE INDEX IF NOT EXISTS idx_documents_extracted_data     ON documents USING GIN (extracted_data);

-- ============================================================
-- TABLE: findings
-- ============================================================
CREATE TABLE IF NOT EXISTS findings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id     UUID NOT NULL REFERENCES lc_presentations (id) ON DELETE CASCADE,
  finding_type        VARCHAR(100) NOT NULL,
  severity            finding_severity NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  affected_documents  TEXT[] NOT NULL DEFAULT '{}',
  affected_fields     TEXT[] NOT NULL DEFAULT '{}',
  verbatim_quotes     JSONB NOT NULL DEFAULT '[]',
  reasoning           TEXT,
  confidence_score    INT CHECK (confidence_score BETWEEN 0 AND 100),
  ucp_articles        TEXT[] NOT NULL DEFAULT '{}',
  recommended_action  TEXT,
  status              finding_status NOT NULL DEFAULT 'open',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_findings_presentation_id  ON findings (presentation_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity         ON findings (severity);
CREATE INDEX IF NOT EXISTS idx_findings_status           ON findings (status);
CREATE INDEX IF NOT EXISTS idx_findings_finding_type     ON findings (finding_type);
CREATE INDEX IF NOT EXISTS idx_findings_verbatim_quotes  ON findings USING GIN (verbatim_quotes);

-- ============================================================
-- TABLE: overrides
-- ============================================================
CREATE TABLE IF NOT EXISTS overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id       UUID NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  user_name        VARCHAR(255) NOT NULL,
  action           override_action NOT NULL,
  override_reason  VARCHAR(500),
  justification    TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overrides_finding_id  ON overrides (finding_id);
CREATE INDEX IF NOT EXISTS idx_overrides_user_id     ON overrides (user_id);
CREATE INDEX IF NOT EXISTS idx_overrides_action      ON overrides (action);
CREATE INDEX IF NOT EXISTS idx_overrides_created_at  ON overrides (created_at DESC);

-- ============================================================
-- TABLE: audit_trail
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_trail (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id  UUID REFERENCES lc_presentations (id) ON DELETE SET NULL,
  event_type       VARCHAR(100) NOT NULL,
  event_data       JSONB NOT NULL DEFAULT '{}',
  user_id          UUID REFERENCES users (id) ON DELETE SET NULL,
  user_name        VARCHAR(255),
  ip_address       INET,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit trail is append-only; no update/delete should ever be issued.
-- Enforce this at application level and optionally via row-level security.
CREATE INDEX IF NOT EXISTS idx_audit_trail_presentation_id  ON audit_trail (presentation_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_event_type       ON audit_trail (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_trail_user_id          ON audit_trail (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created_at       ON audit_trail (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_event_data       ON audit_trail USING GIN (event_data);

-- ============================================================
-- TABLE: custom_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name    VARCHAR(255) NOT NULL,
  rule_type    VARCHAR(100) NOT NULL,
  corridor     VARCHAR(100),
  commodity    VARCHAR(100),
  rule_config  JSONB NOT NULL DEFAULT '{}',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version      INT NOT NULL DEFAULT 1,
  description  TEXT,
  UNIQUE (rule_name, version)
);

CREATE INDEX IF NOT EXISTS idx_custom_rules_rule_type   ON custom_rules (rule_type);
CREATE INDEX IF NOT EXISTS idx_custom_rules_corridor    ON custom_rules (corridor);
CREATE INDEX IF NOT EXISTS idx_custom_rules_commodity   ON custom_rules (commodity);
CREATE INDEX IF NOT EXISTS idx_custom_rules_is_active   ON custom_rules (is_active);
CREATE INDEX IF NOT EXISTS idx_custom_rules_rule_config ON custom_rules USING GIN (rule_config);

-- ============================================================
-- TABLE: fraud_typologies
-- ============================================================
CREATE TABLE IF NOT EXISTS fraud_typologies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL UNIQUE,
  description  TEXT NOT NULL,
  indicators   JSONB NOT NULL DEFAULT '[]',
  risk_level   VARCHAR(50) NOT NULL CHECK (risk_level IN ('critical', 'moderate', 'informational')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_typologies_risk_level  ON fraud_typologies (risk_level);
CREATE INDEX IF NOT EXISTS idx_fraud_typologies_indicators  ON fraud_typologies USING GIN (indicators);

-- ============================================================
-- FUNCTION: update updated_at timestamp automatically
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_lc_presentations_updated_at
  BEFORE UPDATE ON lc_presentations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_custom_rules_updated_at
  BEFORE UPDATE ON custom_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_fraud_typologies_updated_at
  BEFORE UPDATE ON fraud_typologies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SEED: Default fraud typologies
-- ============================================================
INSERT INTO fraud_typologies (name, description, indicators, risk_level)
VALUES
  (
    'Ghost Shipment',
    'Documents presented for goods that were never shipped. Vessel may be real but cargo was not loaded.',
    '[
      {"indicator": "BL on-board date post-dates LC expiry", "weight": 0.9},
      {"indicator": "Vessel name not in AIS records for stated route", "weight": 0.95},
      {"indicator": "Port of loading inconsistent with vessel schedule", "weight": 0.85},
      {"indicator": "Cargo weight implausible for vessel type", "weight": 0.8}
    ]'::jsonb,
    'critical'
  ),
  (
    'Over-Invoicing',
    'Invoice value significantly exceeds fair market value for stated goods and quantity, used for capital flight.',
    '[
      {"indicator": "Unit price deviates >30% from commodity benchmark", "weight": 0.85},
      {"indicator": "HS code inconsistent with goods description", "weight": 0.75},
      {"indicator": "Invoice total exceeds insurance value", "weight": 0.9},
      {"indicator": "Beneficiary in high-risk jurisdiction", "weight": 0.6}
    ]'::jsonb,
    'critical'
  ),
  (
    'Document Fabrication',
    'One or more documents bear signs of forgery or inconsistent issuance metadata.',
    '[
      {"indicator": "Date inconsistencies across same-document fields", "weight": 0.95},
      {"indicator": "Signatory name differs from stated issuing party", "weight": 0.9},
      {"indicator": "Document serial numbers out of sequence", "weight": 0.8},
      {"indicator": "Font or formatting anomalies in critical fields", "weight": 0.7}
    ]'::jsonb,
    'critical'
  ),
  (
    'Circular Trading',
    'Same goods appear to be sold multiple times in a short period, possibly within related parties.',
    '[
      {"indicator": "Applicant and beneficiary share address or phone", "weight": 0.9},
      {"indicator": "Back-to-back LCs with identical goods description", "weight": 0.85},
      {"indicator": "Consignee on BL is same entity as applicant", "weight": 0.8}
    ]'::jsonb,
    'critical'
  ),
  (
    'Diversion Risk',
    'Logistics route or notifying parties suggest goods may be diverted to sanctioned or restricted destinations.',
    '[
      {"indicator": "Transshipment port in sanctioned jurisdiction", "weight": 0.95},
      {"indicator": "Notify party in OFAC/UN sanctions list jurisdiction", "weight": 0.9},
      {"indicator": "Vague goods description inconsistent with HS code", "weight": 0.7},
      {"indicator": "Route commercially implausible for stated Incoterms", "weight": 0.75}
    ]'::jsonb,
    'critical'
  ),
  (
    'Coverage Gap',
    'Insurance coverage does not fully protect the cargo for the stated voyage, leaving value at risk.',
    '[
      {"indicator": "Insurance value less than 110% of CIF invoice value", "weight": 0.9},
      {"indicator": "Perils covered exclude Institute Cargo Clause A risks", "weight": 0.8},
      {"indicator": "Insurance expiry before latest possible arrival date", "weight": 0.85},
      {"indicator": "Claims payable location not accessible to beneficiary", "weight": 0.7}
    ]'::jsonb,
    'moderate'
  )
ON CONFLICT (name) DO NOTHING;
