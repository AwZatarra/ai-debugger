import { clickhouse } from "./clickhouse";
import {
  upsertIncidentEmbedding,
  getLatestIncidentEmbedding,
  cosineSimilarity,
} from "./embeddings";

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

type IncidentEmbeddingRow = {
  incident_id: string;
  created_at: string;
  source_text: string;
  embedding: number[];
  embedding_model: string;
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
  heuristic_score: number;
  semantic_score: number;
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

async function getLatestIncidentEmbeddingsMap(): Promise<Map<string, IncidentEmbeddingRow>> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        incident_id,
        created_at,
        source_text,
        embedding,
        embedding_model
      FROM observability.incident_embeddings
      ORDER BY created_at DESC
      LIMIT 5000
    `,
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<IncidentEmbeddingRow>();
  const map = new Map<string, IncidentEmbeddingRow>();

  for (const row of rows) {
    if (!map.has(row.incident_id)) {
      map.set(row.incident_id, row);
    }
  }

  return map;
}

function computeHeuristicSimilarity(
  current: IncidentRow,
  candidate: IncidentRow
): { score: number; reasons: string[] } {
  const currentEvidence = safeParseJson(current.evidence_json);
  const candidateEvidence = safeParseJson(candidate.evidence_json);

  let score = 0;
  const reasons: string[] = [];

  if (current.fingerprint && candidate.fingerprint && current.fingerprint === candidate.fingerprint) {
    score += 100;
    reasons.push("same fingerprint");
  }

  if (
    current.primary_service &&
    candidate.primary_service &&
    current.primary_service === candidate.primary_service
  ) {
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

  return { score, reasons };
}

function computeSemanticSimilarity(
  currentEmbedding: number[] | null,
  candidateEmbedding: number[] | null
): number {
  if (!currentEmbedding || !candidateEmbedding) {
    return 0;
  }

  try {
    const similarity = cosineSimilarity(currentEmbedding, candidateEmbedding);

    if (!Number.isFinite(similarity)) {
      return 0;
    }

    if (similarity <= 0) {
      return 0;
    }

    return Math.round(similarity * 100);
  } catch {
    return 0;
  }
}

function computeFinalSimilarity(
  current: IncidentRow,
  candidate: IncidentRow,
  currentEmbedding: number[] | null,
  candidateEmbedding: number[] | null
): SimilarIncidentResult | null {
  const heuristic = computeHeuristicSimilarity(current, candidate);
  const semanticScore = computeSemanticSimilarity(currentEmbedding, candidateEmbedding);

  const reasons = [...heuristic.reasons];
  if (semanticScore > 0) {
    reasons.push(`semantic similarity ${semanticScore}`);
  }

  let finalScore = heuristic.score + semanticScore;

  // Penaliza coincidencias puramente semánticas para evitar ruido.
  if (heuristic.score === 0 && semanticScore > 0) {
    finalScore = Math.round(finalScore * 0.6);
  }

  if (finalScore === 0) {
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
    heuristic_score: heuristic.score,
    semantic_score: semanticScore,
    similarity_score: finalScore,
  };
}

export async function reindexIncidentEmbedding(incidentId: string) {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    return null;
  }

  const embeddingRow = await upsertIncidentEmbedding(incidentId);

  return {
    incident_id: incident.incident_id,
    title: incident.title,
    embedded: Boolean(embeddingRow),
    embedding_model: embeddingRow?.embedding_model || null,
    embedded_at: embeddingRow?.created_at || null,
  };
}

export async function reindexAllIncidentEmbeddings(limit = 100) {
  const safeLimit = Math.max(1, Math.min(limit, 1000));

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
      ORDER BY created_at DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      limit: safeLimit,
    },
    format: "JSONEachRow",
  });

  const incidents = await resultSet.json<IncidentRow>();

  const results: Array<{
    incident_id: string;
    status: "indexed" | "failed";
    error?: string;
  }> = [];

  for (const incident of incidents) {
    try {
      await upsertIncidentEmbedding(incident.incident_id);
      results.push({
        incident_id: incident.incident_id,
        status: "indexed",
      });
    } catch (error: any) {
      results.push({
        incident_id: incident.incident_id,
        status: "failed",
        error: error?.message || "Unknown embedding error",
      });
    }
  }

  return {
    total_requested: safeLimit,
    total_found: incidents.length,
    indexed_count: results.filter((r) => r.status === "indexed").length,
    failed_count: results.filter((r) => r.status === "failed").length,
    results,
  };
}

export async function findSimilarIncidents(incidentId: string) {
  const current = await getIncidentById(incidentId);
  if (!current) {
    return null;
  }

  let currentEmbeddingRow = await getLatestIncidentEmbedding(incidentId);

  if (!currentEmbeddingRow) {
    try {
      await upsertIncidentEmbedding(incidentId);
      currentEmbeddingRow = await getLatestIncidentEmbedding(incidentId);
    } catch (error: any) {
      console.warn(
        `[similarIncidents] failed to build incident embedding for ${incidentId}: ${error?.message || "unknown error"}`
      );
    }
  }

  const currentEmbedding = currentEmbeddingRow?.embedding || null;
  const candidates = await getCandidateIncidents(incidentId);
  const embeddingMap = await getLatestIncidentEmbeddingsMap();

  const similar = candidates
    .map((candidate) =>
      computeFinalSimilarity(
        current,
        candidate,
        currentEmbedding,
        embeddingMap.get(candidate.incident_id)?.embedding || null
      )
    )
    .filter((item): item is SimilarIncidentResult => Boolean(item))
    .sort((a, b) => {
      if (b.similarity_score !== a.similarity_score) {
        return b.similarity_score - a.similarity_score;
      }
      if (b.heuristic_score !== a.heuristic_score) {
        return b.heuristic_score - a.heuristic_score;
      }
      return b.semantic_score - a.semantic_score;
    })
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
    retrieval: {
      mode: "hybrid",
      incident_embedding_found: Boolean(currentEmbeddingRow),
      incident_embedding_model: currentEmbeddingRow?.embedding_model || null,
      total_candidates_scanned: candidates.length,
      total_candidate_embeddings_loaded: embeddingMap.size,
    },
    similar_count: similar.length,
    similar_incidents: similar,
  };
}