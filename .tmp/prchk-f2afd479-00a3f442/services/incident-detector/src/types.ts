export type AggregatedErrorRow = {
  service: string;
  route: string;
  error_code: string;
  error_type: string;
  total_errors: number;
  sample_message: string;
  sample_trace: string;
  first_seen: string;
  last_seen: string;
};

export type IncidentRecord = {
  incident_id: string;
  created_at: string;
  status: string;
  fingerprint: string;
  title: string;
  primary_service: string;
  severity: string;
  trace_id: string;
  error_type: string;
  error_message: string;
  evidence_json: string;
};