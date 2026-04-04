import { clickhouse } from "./clickhouse";
import { buildIncidentContext } from "./contextBuilder";

type RCAReport = {
  incident_id: string;
  analyzed_at: string;
  probable_root_cause: string;
  confidence: number;
  explanation: string;
  suggested_fix: string;
  suggested_patch: string;
  related_incidents: string;
  llm_model: string;
};

type ContextLog = {
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

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildTimeoutFix(service: string, route: string): string {
  return [
    `Review timeout handling in ${service} on ${route}.`,
    `Validate DB/network connectivity.`,
    `Check connection pool saturation.`,
    `Review retry/circuit breaker strategy.`,
    `Inspect slow queries or dependency latency.`
  ].join(" ");
}

function buildTimeoutPatchSuggestion(service: string): string {
  return [
    `// Suggested follow-up for ${service}`,
    `// 1. Review DB client timeout`,
    `// 2. Increase observability around dependency latency`,
    `// 3. Add retry or circuit breaker if safe`,
  ].join("\n");
}

function findRootCauseCandidate(logs: ContextLog[], primaryService: string): ContextLog | null {
  const errorLogs = logs
    .filter((log) => log.level === "error")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (errorLogs.length === 0) return null;

  // 1) If the primary service itself emitted the earliest error, keep it as root cause
  const primaryError = errorLogs.find((log) => log.service === primaryService);
  if (primaryError && errorLogs[0].service === primaryService) {
    return primaryError;
  }

  // 2) Otherwise use the earliest error in the trace
  return errorLogs[0];
}

async function findRelatedIncidentsByFingerprint(fingerprint: string): Promise<string[]> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT incident_id
      FROM observability.incidents
      WHERE fingerprint = {fingerprint:String}
      ORDER BY created_at DESC
      LIMIT 5
    `,
    query_params: {
      fingerprint,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{ incident_id: string }>();
  return rows.map((row) => row.incident_id);
}

async function existingRcaReport(incidentId: string): Promise<RCAReport | null> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        incident_id,
        analyzed_at,
        probable_root_cause,
        confidence,
        explanation,
        suggested_fix,
        suggested_patch,
        related_incidents,
        llm_model
      FROM observability.rca_reports
      WHERE incident_id = {incident_id:UUID}
      ORDER BY analyzed_at DESC
      LIMIT 1
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<RCAReport>();
  return rows[0] || null;
}

export async function analyzeIncident(incidentId: string) {
  const existing = await existingRcaReport(incidentId);
  if (existing) {
    return {
      already_exists: true,
      report: existing,
    };
  }

  const context = await buildIncidentContext(incidentId);
  if (!context) {
    return null;
  }

  const incident = context.incident;
  const traceLogs = context.trace_logs as ContextLog[];
  const correlatedErrors = context.correlated_errors as ContextLog[];
  const evidence = context.evidence as Record<string, any>;

  const fingerprint = incident.fingerprint;
  const relatedIncidentIds = await findRelatedIncidentsByFingerprint(fingerprint);

  let probableRootCause = `${incident.primary_service} failed on ${evidence.route || "unknown route"} with ${evidence.error_code || incident.error_type}`;
  let confidence = 0.6;
  let explanation = `Incident detected from repeated errors on ${incident.primary_service}.`;
  let suggestedFix = `Review logs and dependency behavior for ${incident.primary_service}.`;
  let suggestedPatch = `// No patch suggestion available yet`;
  

  const rootCauseCandidate = findRootCauseCandidate(correlatedErrors, incident.primary_service);

if (rootCauseCandidate) {
  probableRootCause =
    `${rootCauseCandidate.service} failed first on ${rootCauseCandidate.route} ` +
    `with ${rootCauseCandidate.error_code || rootCauseCandidate.error_type}`;

  confidence = rootCauseCandidate.service === incident.primary_service ? 0.95 : 0.92;

  if (rootCauseCandidate.service === incident.primary_service) {
    explanation =
      `The earliest correlated error in the trace was emitted by ${incident.primary_service}. ` +
      `This indicates the incident likely originated in the same service rather than being propagated from another dependency.`;
  } else {
    explanation =
      `The earliest correlated error in the trace was emitted by ${rootCauseCandidate.service} before ${incident.primary_service}. ` +
      `This suggests the incident in ${incident.primary_service} is a propagated symptom, not the origin.`;
  }

  suggestedFix = buildTimeoutFix(
    rootCauseCandidate.service,
    rootCauseCandidate.route || "unknown route"
  );

  suggestedPatch = buildTimeoutPatchSuggestion(rootCauseCandidate.service);
} else if ((evidence.error_code || "").includes("TIMEOUT")) {
    probableRootCause = `${incident.primary_service} is likely timing out on ${evidence.route || "unknown route"}`;
    confidence = 0.85;
    explanation =
      `Multiple timeout-related errors were detected for ${incident.primary_service} on the same route within the time window.`;
    suggestedFix = buildTimeoutFix(
      incident.primary_service,
      evidence.route || "unknown route"
    );
    suggestedPatch = buildTimeoutPatchSuggestion(incident.primary_service);
  } else {
    // Try to infer from service-a payload showing upstream failure
    const upstreamHint = traceLogs.find((log) => {
      if (log.service !== incident.primary_service && log.level === "error") return true;

      const payload = safeJsonParse(log.payload || "{}");
      return payload?.upstream_status || payload?.upstream_data?.error;
    });

    if (upstreamHint) {
      const payload = safeJsonParse(upstreamHint.payload || "{}");
      probableRootCause =
        `${upstreamHint.service} likely triggered the failure chain` +
        `${payload?.upstream_data?.error ? ` (${payload.upstream_data.error})` : ""}`;
      confidence = 0.8;
      explanation =
        `The incident context includes upstream/downstream failure evidence in the same trace, suggesting a propagated error chain.`;
      suggestedFix = `Inspect the dependency chain around ${upstreamHint.service} and validate upstream failure handling, retries, and timeout settings.`;
      suggestedPatch = `// Add stronger upstream error classification and dependency resilience handling`;
    }
  }

  const report: RCAReport = {
    incident_id: incident.incident_id,
    analyzed_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    probable_root_cause: probableRootCause,
    confidence,
    explanation,
    suggested_fix: suggestedFix,
    suggested_patch: suggestedPatch,
    related_incidents: JSON.stringify(relatedIncidentIds),
    llm_model: "heuristic-v1",
  };

  await clickhouse.insert({
    table: "observability.rca_reports",
    values: [report],
    format: "JSONEachRow",
  });

  return {
    already_exists: false,
    report,
    context_summary: {
      trace_id: incident.trace_id,
      primary_service: incident.primary_service,
      correlated_error_count: correlatedErrors.length,
      trace_log_count: traceLogs.length,
    },
  };
}