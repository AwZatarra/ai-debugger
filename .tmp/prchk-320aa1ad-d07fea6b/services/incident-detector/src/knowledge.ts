import { randomUUID } from "crypto";
import { clickhouse } from "./clickhouse";
import {
  upsertKnowledgeEmbedding,
  upsertIncidentEmbedding,
  getLatestIncidentEmbedding,
  cosineSimilarity,
} from "./embeddings";

type KnowledgeChunk = {
  chunk_id: string;
  created_at: string;
  source_type: string;
  source_name: string;
  service: string;
  route: string;
  error_code: string;
  tags: string;
  text: string;
};

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

type KnowledgeEmbeddingRow = {
  chunk_id: string;
  created_at: string;
  source_text: string;
  embedding: number[];
  embedding_model: string;
};

type KnowledgeMatch = KnowledgeChunk & {
  match_reason: string;
  heuristic_score: number;
  semantic_score: number;
  match_score: number;
};

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function createKnowledgeChunk(input: {
  source_type: string;
  source_name: string;
  service?: string;
  route?: string;
  error_code?: string;
  tags?: string[];
  text: string;
}) {
  const row: KnowledgeChunk = {
    chunk_id: randomUUID(),
    created_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    source_type: input.source_type,
    source_name: input.source_name,
    service: input.service || "",
    route: input.route || "",
    error_code: input.error_code || "",
    tags: JSON.stringify(input.tags || []),
    text: input.text,
  };

  await clickhouse.insert({
    table: "observability.knowledge_chunks",
    values: [row],
    format: "JSONEachRow",
  });

  let embeddingIndexed = false;
  let embeddingError: string | null = null;

  try {
    await upsertKnowledgeEmbedding(row.chunk_id);
    embeddingIndexed = true;
  } catch (error: any) {
    embeddingIndexed = false;
    embeddingError = error?.message || "Unknown embedding error";
    console.warn(
      `[knowledge] chunk created but embedding indexing failed for ${row.chunk_id}: ${embeddingError}`
    );
  }

  return {
    ...row,
    embedding_indexed: embeddingIndexed,
    embedding_error: embeddingError,
  };
}

export async function listKnowledgeChunks() {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        chunk_id,
        created_at,
        source_type,
        source_name,
        service,
        route,
        error_code,
        tags,
        text
      FROM observability.knowledge_chunks
      ORDER BY created_at DESC
      LIMIT 100
    `,
    format: "JSONEachRow",
  });

  return await resultSet.json<KnowledgeChunk>();
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

async function getKnowledgeChunkById(chunkId: string): Promise<KnowledgeChunk | null> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        chunk_id,
        created_at,
        source_type,
        source_name,
        service,
        route,
        error_code,
        tags,
        text
      FROM observability.knowledge_chunks
      WHERE chunk_id = {chunk_id:UUID}
      LIMIT 1
    `,
    query_params: {
      chunk_id: chunkId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<KnowledgeChunk>();
  return rows[0] || null;
}

async function getLatestKnowledgeEmbeddingsMap(): Promise<Map<string, KnowledgeEmbeddingRow>> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        chunk_id,
        created_at,
        source_text,
        embedding,
        embedding_model
      FROM observability.knowledge_embeddings
      ORDER BY created_at DESC
      LIMIT 5000
    `,
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<KnowledgeEmbeddingRow>();
  const map = new Map<string, KnowledgeEmbeddingRow>();

  for (const row of rows) {
    if (!map.has(row.chunk_id)) {
      map.set(row.chunk_id, row);
    }
  }

  return map;
}

function computeHeuristicKnowledgeScore(
  incident: IncidentRow,
  evidence: any,
  chunk: KnowledgeChunk
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (chunk.service && chunk.service === incident.primary_service) {
    score += 40;
    reasons.push("same primary service");
  }

  if (chunk.route && evidence.route && chunk.route === evidence.route) {
    score += 35;
    reasons.push("same route");
  }

  if (chunk.error_code && evidence.error_code && chunk.error_code === evidence.error_code) {
    score += 50;
    reasons.push("same error code");
  }

  if (
    incident.error_type &&
    chunk.text.toLowerCase().includes(incident.error_type.toLowerCase())
  ) {
    score += 10;
    reasons.push("mentions error type");
  }

  const chunkTags: string[] = safeParseJson(chunk.tags);
  const tagsLower = chunkTags.map((t) => String(t).toLowerCase());

  if (tagsLower.includes((incident.primary_service || "").toLowerCase())) {
    score += 15;
    reasons.push("tag matches service");
  }

  if (evidence.error_code && tagsLower.includes(String(evidence.error_code).toLowerCase())) {
    score += 20;
    reasons.push("tag matches error code");
  }

  return { score, reasons };
}

function computeSemanticScore(
  incidentEmbedding: number[] | null,
  knowledgeEmbedding: number[] | null
): number {
  if (!incidentEmbedding || !knowledgeEmbedding) {
    return 0;
  }

  try {
    const similarity = cosineSimilarity(incidentEmbedding, knowledgeEmbedding);

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

function computeFinalKnowledgeMatch(
  incident: IncidentRow,
  evidence: any,
  chunk: KnowledgeChunk,
  incidentEmbedding: number[] | null,
  knowledgeEmbedding: number[] | null
): KnowledgeMatch | null {
  const heuristic = computeHeuristicKnowledgeScore(incident, evidence, chunk);
  const semanticScore = computeSemanticScore(incidentEmbedding, knowledgeEmbedding);

  const reasons = [...heuristic.reasons];
  if (semanticScore > 0) {
    reasons.push(`semantic similarity ${semanticScore}`);
  }

  let finalScore = heuristic.score + semanticScore;

  if (heuristic.score === 0) {
    finalScore = Math.round(finalScore * 0.6);
  }

  if (finalScore === 0) {
    return null;
  }

  return {
    ...chunk,
    match_reason: reasons.join(", "),
    heuristic_score: heuristic.score,
    semantic_score: semanticScore,
    match_score: finalScore,
  };
}

export async function getKnowledgeForIncident(incidentId: string) {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    return null;
  }

  const evidence = safeParseJson(incident.evidence_json);

  let incidentEmbeddingRow = await getLatestIncidentEmbedding(incidentId);

  if (!incidentEmbeddingRow) {
    try {
      await upsertIncidentEmbedding(incidentId);
      incidentEmbeddingRow = await getLatestIncidentEmbedding(incidentId);
    } catch (error: any) {
      console.warn(
        `[knowledge] failed to build incident embedding for ${incidentId}: ${error?.message || "unknown error"}`
      );
    }
  }

  const incidentEmbedding = incidentEmbeddingRow?.embedding || null;

  const chunkResultSet = await clickhouse.query({
    query: `
      SELECT
        chunk_id,
        created_at,
        source_type,
        source_name,
        service,
        route,
        error_code,
        tags,
        text
      FROM observability.knowledge_chunks
      ORDER BY created_at DESC
      LIMIT 500
    `,
    format: "JSONEachRow",
  });

  const chunks = await chunkResultSet.json<KnowledgeChunk>();
  const embeddingMap = await getLatestKnowledgeEmbeddingsMap();

  const matches = chunks
    .map((chunk) =>
      computeFinalKnowledgeMatch(
        incident,
        evidence,
        chunk,
        incidentEmbedding,
        embeddingMap.get(chunk.chunk_id)?.embedding || null
      )
    )
    .filter((item): item is KnowledgeMatch => Boolean(item))
    .sort((a, b) => {
      if (b.match_score !== a.match_score) {
        return b.match_score - a.match_score;
      }
      if (b.heuristic_score !== a.heuristic_score) {
        return b.heuristic_score - a.heuristic_score;
      }
      return b.semantic_score - a.semantic_score;
    })
    .slice(0, 20);

  return {
    incident: {
      incident_id: incident.incident_id,
      title: incident.title,
      primary_service: incident.primary_service,
      fingerprint: incident.fingerprint,
      error_type: incident.error_type,
      evidence,
    },
    retrieval: {
      mode: "hybrid",
      incident_embedding_found: Boolean(incidentEmbeddingRow),
      incident_embedding_model: incidentEmbeddingRow?.embedding_model || null,
      total_chunks_scanned: chunks.length,
      total_chunk_embeddings_loaded: embeddingMap.size,
    },
    matched_count: matches.length,
    matches,
  };
}

export async function reindexKnowledgeChunkEmbedding(chunkId: string) {
  const chunk = await getKnowledgeChunkById(chunkId);
  if (!chunk) {
    return null;
  }

  const embeddingRow = await upsertKnowledgeEmbedding(chunkId);

  return {
    chunk_id: chunk.chunk_id,
    source_name: chunk.source_name,
    embedded: Boolean(embeddingRow),
    embedding_model: embeddingRow?.embedding_model || null,
    embedded_at: embeddingRow?.created_at || null,
  };
}

export async function reindexAllKnowledgeEmbeddings(limit = 100) {
  const safeLimit = Math.max(1, Math.min(limit, 1000));

  const resultSet = await clickhouse.query({
    query: `
      SELECT
        chunk_id,
        created_at,
        source_type,
        source_name,
        service,
        route,
        error_code,
        tags,
        text
      FROM observability.knowledge_chunks
      ORDER BY created_at DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      limit: safeLimit,
    },
    format: "JSONEachRow",
  });

  const chunks = await resultSet.json<KnowledgeChunk>();

  const results: Array<{
    chunk_id: string;
    status: "indexed" | "failed";
    error?: string;
  }> = [];

  for (const chunk of chunks) {
    try {
      await upsertKnowledgeEmbedding(chunk.chunk_id);
      results.push({
        chunk_id: chunk.chunk_id,
        status: "indexed",
      });
    } catch (error: any) {
      results.push({
        chunk_id: chunk.chunk_id,
        status: "failed",
        error: error?.message || "Unknown embedding error",
      });
    }
  }

  return {
    total_requested: safeLimit,
    total_found: chunks.length,
    indexed_count: results.filter((r) => r.status === "indexed").length,
    failed_count: results.filter((r) => r.status === "failed").length,
    results,
  };
}