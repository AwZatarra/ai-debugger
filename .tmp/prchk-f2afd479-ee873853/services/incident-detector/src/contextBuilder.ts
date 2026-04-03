import { clickhouse } from "./clickhouse";

type IncidentRow = {
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

type LogRow = {
  timestamp: string;
  service: string;
  environment: string;
  level: string;
  message: string;
  trace_id: string;
  span_id: string;
  request_id: string;
  route: string;
  error_code: string;
  error_type: string;
  stack_trace: string;
  payload: string;
};

export async function getIncidentById(incidentId: string): Promise<IncidentRow | null> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        incident_id,
        created_at,
        status,
        fingerprint,
        title,
        primary_service,
        severity,
        trace_id,
        error_type,
        error_message,
        evidence_json
      FROM observability.incidents
      WHERE incident_id = {incident_id:UUID}
      LIMIT 1
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<IncidentRow>();
  return rows[0] || null;
}

export async function getLogsByTraceId(traceId: string): Promise<LogRow[]> {
  if (!traceId) return [];

  const resultSet = await clickhouse.query({
    query: `
      SELECT
        timestamp,
        service,
        environment,
        level,
        message,
        trace_id,
        span_id,
        request_id,
        route,
        error_code,
        error_type,
        stack_trace,
        payload
      FROM observability.logs
      WHERE trace_id = {trace_id:String}
      ORDER BY timestamp ASC
      LIMIT 200
    `,
    query_params: {
      trace_id: traceId,
    },
    format: "JSONEachRow",
  });

  return await resultSet.json<LogRow>();
}

export async function getNearbyLogs(
  createdAt: string,
  primaryService: string
): Promise<LogRow[]> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        timestamp,
        service,
        environment,
        level,
        message,
        trace_id,
        span_id,
        request_id,
        route,
        error_code,
        error_type,
        stack_trace,
        payload
      FROM observability.logs
      WHERE service = {primary_service:String}
        AND timestamp BETWEEN
          parseDateTime64BestEffort({created_at:String}) - toIntervalMinute(2)
          AND
          parseDateTime64BestEffort({created_at:String}) + toIntervalMinute(2)
      ORDER BY timestamp ASC
      LIMIT 200
    `,
    query_params: {
      created_at: createdAt,
      primary_service: primaryService,
    },
    format: "JSONEachRow",
  });

  return await resultSet.json<LogRow>();
}

export async function getCorrelatedErrorsByTraceId(traceId: string): Promise<LogRow[]> {
  if (!traceId) return [];

  const resultSet = await clickhouse.query({
    query: `
      SELECT
        timestamp,
        service,
        environment,
        level,
        message,
        trace_id,
        span_id,
        request_id,
        route,
        error_code,
        error_type,
        stack_trace,
        payload
      FROM observability.logs
      WHERE trace_id = {trace_id:String}
        AND level = 'error'
      ORDER BY timestamp ASC
      LIMIT 100
    `,
    query_params: {
      trace_id: traceId,
    },
    format: "JSONEachRow",
  });

  return await resultSet.json<LogRow>();
}

export async function buildIncidentContext(incidentId: string) {
  const incident = await getIncidentById(incidentId);

  if (!incident) {
    return null;
  }

  const traceLogs = await getLogsByTraceId(incident.trace_id);
  const nearbyLogs = await getNearbyLogs(incident.created_at, incident.primary_service);
  const correlatedErrors = await getCorrelatedErrorsByTraceId(incident.trace_id);

  const parsedEvidence = (() => {
    try {
      return JSON.parse(incident.evidence_json || "{}");
    } catch {
      return {};
    }
  })();

  return {
    incident,
    summary: {
      incident_id: incident.incident_id,
      title: incident.title,
      primary_service: incident.primary_service,
      severity: incident.severity,
      trace_id: incident.trace_id,
      error_type: incident.error_type,
      error_message: incident.error_message,
    },
    evidence: parsedEvidence,
    trace_logs: traceLogs,
    nearby_logs: nearbyLogs,
    correlated_errors: correlatedErrors,
  };
}