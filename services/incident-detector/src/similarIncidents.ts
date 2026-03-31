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

type SimilarIncidentResult = {
  incident_id: string;
  created_at: string;
  title: string;
  primary_service: string;
  severity: string;
  fingerprint: string;
  trace_id: string;
  error_type: string;
  error_message: string;
  similarity_reason: string;
  similarity_score: number;
};

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function getIncidentById(incidentId: string): Promise<IncidentRow | null> {
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

async function getCandidateIncidents(currentIncidentId: string): Promise<IncidentRow[]> {
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
      WHERE incident_id != {incident_id:UUID}
      ORDER BY created_at DESC
      LIMIT 200
    `,
    query_params: {
      incident_id: currentIncidentId,
    },
    format: "JSONEachRow",
  });

  return await resultSet.json<IncidentRow>();
}

function computeSimilarity(current: IncidentRow, candidate: IncidentRow): SimilarIncidentResult | null {
  const currentEvidence = safeParseJson(current.evidence_json);
  const candidateEvidence = safeParseJson(candidate.evidence_json);

  let score = 0;
  const reasons: string[] = [];

  if (current.fingerprint && candidate.fingerprint && current.fingerprint === candidate.fingerprint) {
    score += 100;
    reasons.push("same fingerprint");
  }

  if (current.primary_service && candidate.primary_service && current.primary_service === candidate.primary_service) {
    score += 30;
    reasons.push("same primary service");
  }

  if (current.error_type && candidate.error_type && current.error_type === candidate.error_type) {
    score += 20;
    reasons.push("same error type");
  }

  if (current.trace_id && candidate.trace_id && current.trace_id === candidate.trace_id) {
    score += 15;
    reasons.push("same trace");
  }

  if (
    currentEvidence.route &&
    candidateEvidence.route &&
    currentEvidence.route === candidateEvidence.route
  ) {
    score += 20;
    reasons.push("same route");
  }

  if (
    currentEvidence.error_code &&
    candidateEvidence.error_code &&
    currentEvidence.error_code === candidateEvidence.error_code
  ) {
    score += 35;
    reasons.push("same error code");
  }

  if (
    currentEvidence.service &&
    candidateEvidence.service &&
    currentEvidence.service === candidateEvidence.service
  ) {
    score += 25;
    reasons.push("same evidence service");
  }

  if (score === 0) {
    return null;
  }

  return {
    incident_id: candidate.incident_id,
    created_at: candidate.created_at,
    title: candidate.title,
    primary_service: candidate.primary_service,
    severity: candidate.severity,
    fingerprint: candidate.fingerprint,
    trace_id: candidate.trace_id,
    error_type: candidate.error_type,
    error_message: candidate.error_message,
    similarity_reason: reasons.join(", "),
    similarity_score: score,
  };
}

export async function findSimilarIncidents(incidentId: string) {
  const current = await getIncidentById(incidentId);
  if (!current) {
    return null;
  }

  const candidates = await getCandidateIncidents(incidentId);

  const similar = candidates
    .map((candidate) => computeSimilarity(current, candidate))
    .filter((item): item is SimilarIncidentResult => Boolean(item))
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, 20);

  return {
    base_incident: {
      incident_id: current.incident_id,
      title: current.title,
      primary_service: current.primary_service,
      fingerprint: current.fingerprint,
      trace_id: current.trace_id,
      error_type: current.error_type,
    },
    total_candidates_scanned: candidates.length,
    similar_count: similar.length,
    similar_incidents: similar,
  };
}