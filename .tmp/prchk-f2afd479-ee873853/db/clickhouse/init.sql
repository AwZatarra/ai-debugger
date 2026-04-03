CREATE DATABASE IF NOT EXISTS observability;

CREATE TABLE IF NOT EXISTS observability.logs
(
  timestamp DateTime64(3),
  service String,
  environment String,
  level String,
  message String,
  trace_id String,
  span_id String,
  request_id String,
  route String,
  error_code String,
  error_type String,
  stack_trace String,
  payload String
)
ENGINE = MergeTree
ORDER BY (service, timestamp);

CREATE TABLE IF NOT EXISTS observability.incidents
(
  incident_id UUID,
  created_at DateTime64(3),
  status String,
  fingerprint String,
  title String,
  primary_service String,
  severity String,
  trace_id String,
  error_type String,
  error_message String,
  evidence_json String
)
ENGINE = MergeTree
ORDER BY (created_at, primary_service);

CREATE TABLE IF NOT EXISTS observability.rca_reports
(
  incident_id UUID,
  analyzed_at DateTime64(3),
  probable_root_cause String,
  confidence Float32,
  explanation String,
  suggested_fix String,
  suggested_patch String,
  related_incidents String,
  llm_model String
)
ENGINE = MergeTree
ORDER BY (analyzed_at, incident_id);

CREATE TABLE IF NOT EXISTS observability.knowledge_chunks
(
  chunk_id UUID,
  created_at DateTime64(3),
  source_type String,
  source_name String,
  service String,
  route String,
  error_code String,
  tags String,
  text String
)
ENGINE = MergeTree
ORDER BY (service, route, error_code, created_at);

CREATE TABLE IF NOT EXISTS observability.incident_embeddings
(
  incident_id UUID,
  created_at DateTime64(3),
  source_text String,
  embedding Array(Float32),
  embedding_model String
)
ENGINE = MergeTree
ORDER BY (incident_id, created_at);

CREATE TABLE IF NOT EXISTS observability.knowledge_embeddings
(
  chunk_id UUID,
  created_at DateTime64(3),
  source_text String,
  embedding Array(Float32),
  embedding_model String
)
ENGINE = MergeTree
ORDER BY (chunk_id, created_at);

CREATE TABLE IF NOT EXISTS observability.incident_feedback
(
  feedback_id UUID,
  incident_id UUID,
  created_at DateTime64(3),
  reviewer String,
  report_type String,
  was_useful UInt8,
  was_correct UInt8,
  selected_root_cause String,
  selected_fix String,
  notes String
)
ENGINE = MergeTree
ORDER BY (incident_id, created_at);

CREATE TABLE IF NOT EXISTS observability.pr_actions
(
  action_id UUID,
  incident_id UUID,
  created_at DateTime64(3),
  repository String,
  branch_name String,
  pr_url String,
  status String,
  payload_json String
)
ENGINE = MergeTree
ORDER BY (incident_id, created_at);

CREATE TABLE IF NOT EXISTS observability.llm_cause_rankings
(
  incident_id UUID,
  analyzed_at DateTime64(3),
  llm_model String,
  summary String,
  ranked_causes_json String
)
ENGINE = MergeTree
ORDER BY (incident_id, analyzed_at);

CREATE TABLE IF NOT EXISTS observability.llm_cause_ranking_feedback
(
  feedback_id UUID,
  incident_id UUID,
  reviewed_at DateTime64(3),
  reviewer String,
  verdict String,
  selected_rank UInt8,
  selected_cause String,
  actual_root_cause String,
  actual_fix String,
  notes String
)
ENGINE = MergeTree
ORDER BY (incident_id, reviewed_at);

CREATE TABLE IF NOT EXISTS observability.pr_proposals
(
  proposal_id UUID,
  incident_id UUID,
  created_at DateTime64(3),
  status String,
  llm_model String,
  repository String,
  target_branch String,
  title String,
  summary String,
  risk_level String,
  allowlisted_paths_json String,
  changed_files_json String,
  checks_json String,
  payload_json String,
  reviewed_at Nullable(DateTime64(3)),
  reviewer String,
  review_notes String
)
ENGINE = MergeTree
ORDER BY (incident_id, created_at);

