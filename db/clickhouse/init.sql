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