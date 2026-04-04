import { clickhouse } from "./clickhouse";
import { openai } from "./openaiClient";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

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

type KnowledgeChunkRow = {
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

type IncidentEmbeddingRow = {
  incident_id: string;
  created_at: string;
  source_text: string;
  embedding: number[];
  embedding_model: string;
};

type KnowledgeEmbeddingRow = {
  chunk_id: string;
  created_at: string;
  source_text: string;
  embedding: number[];
  embedding_model: string;
};

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

async function getKnowledgeChunkById(chunkId: string): Promise<KnowledgeChunkRow | null> {
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

  const rows = await resultSet.json<KnowledgeChunkRow>();
  return rows[0] || null;
}

async function getIncidentTraceErrorLines(traceId: string): Promise<string[]> {
  if (!traceId) return [];

  const resultSet = await clickhouse.query({
    query: `
      SELECT
        timestamp,
        service,
        route,
        error_code,
        error_type,
        message
      FROM observability.logs
      WHERE trace_id = {trace_id:String}
        AND level = 'error'
      ORDER BY timestamp ASC
      LIMIT 10
    `,
    query_params: {
      trace_id: traceId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{
    timestamp: string;
    service: string;
    route: string;
    error_code: string;
    error_type: string;
    message: string;
  }>();

  return rows.map((row) =>
    normalizeWhitespace(
      [
        `timestamp=${row.timestamp || ""}`,
        `service=${row.service || ""}`,
        `route=${row.route || ""}`,
        `error_code=${row.error_code || ""}`,
        `error_type=${row.error_type || ""}`,
        `message=${row.message || ""}`,
      ].join(" | ")
    )
  );
}

export async function buildIncidentEmbeddingText(incidentId: string): Promise<string | null> {
  const incident = await getIncidentById(incidentId);
  if (!incident) return null;

  const evidence = safeParseJson(incident.evidence_json);
  const errorLines = await getIncidentTraceErrorLines(incident.trace_id);

  const text = [
    `incident_id: ${incident.incident_id}`,
    `title: ${incident.title || ""}`,
    `primary_service: ${incident.primary_service || ""}`,
    `severity: ${incident.severity || ""}`,
    `fingerprint: ${incident.fingerprint || ""}`,
    `trace_id: ${incident.trace_id || ""}`,
    `error_type: ${incident.error_type || ""}`,
    `error_message: ${incident.error_message || ""}`,
    `route: ${evidence.route || ""}`,
    `error_code: ${evidence.error_code || ""}`,
    `evidence_service: ${evidence.service || ""}`,
    `evidence_message: ${evidence.message || ""}`,
    `trace_error_summary: ${errorLines.join(" || ")}`,
  ]
    .map((line) => normalizeWhitespace(line))
    .join("\n");

  return text;
}

export async function buildKnowledgeEmbeddingText(chunkId: string): Promise<string | null> {
  const chunk = await getKnowledgeChunkById(chunkId);
  if (!chunk) return null;

  const tags = safeParseJson(chunk.tags);
  const tagsText = Array.isArray(tags) ? tags.join(", ") : "";

  const text = [
    `chunk_id: ${chunk.chunk_id}`,
    `source_type: ${chunk.source_type || ""}`,
    `source_name: ${chunk.source_name || ""}`,
    `service: ${chunk.service || ""}`,
    `route: ${chunk.route || ""}`,
    `error_code: ${chunk.error_code || ""}`,
    `tags: ${tagsText}`,
    `content: ${chunk.text || ""}`,
  ]
    .map((line) => normalizeWhitespace(line))
    .join("\n");

  return text;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const cleanText = normalizeWhitespace(text);

  if (!cleanText) {
    throw new Error("Cannot generate embedding for empty text");
  }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleanText,
  });

  const embedding = response.data?.[0]?.embedding;

  if (!embedding || !Array.isArray(embedding)) {
    throw new Error("Embedding generation failed: empty embedding returned");
  }

  return embedding;
}

export async function getLatestIncidentEmbedding(
  incidentId: string
): Promise<IncidentEmbeddingRow | null> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        incident_id,
        created_at,
        source_text,
        embedding,
        embedding_model
      FROM observability.incident_embeddings
      WHERE incident_id = {incident_id:UUID}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<IncidentEmbeddingRow>();
  return rows[0] || null;
}

export async function getLatestKnowledgeEmbedding(
  chunkId: string
): Promise<KnowledgeEmbeddingRow | null> {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        chunk_id,
        created_at,
        source_text,
        embedding,
        embedding_model
      FROM observability.knowledge_embeddings
      WHERE chunk_id = {chunk_id:UUID}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    query_params: {
      chunk_id: chunkId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<KnowledgeEmbeddingRow>();
  return rows[0] || null;
}

export async function upsertIncidentEmbedding(incidentId: string) {
  const sourceText = await buildIncidentEmbeddingText(incidentId);
  if (!sourceText) {
    return null;
  }

  const embedding = await generateEmbedding(sourceText);

  const row: IncidentEmbeddingRow = {
    incident_id: incidentId,
    created_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    source_text: sourceText,
    embedding,
    embedding_model: EMBEDDING_MODEL,
  };

  await clickhouse.insert({
    table: "observability.incident_embeddings",
    values: [row],
    format: "JSONEachRow",
  });

  return row;
}

export async function upsertKnowledgeEmbedding(chunkId: string) {
  const sourceText = await buildKnowledgeEmbeddingText(chunkId);
  if (!sourceText) {
    return null;
  }

  const embedding = await generateEmbedding(sourceText);

  const row: KnowledgeEmbeddingRow = {
    chunk_id: chunkId,
    created_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    source_text: sourceText,
    embedding,
    embedding_model: EMBEDDING_MODEL,
  };

  await clickhouse.insert({
    table: "observability.knowledge_embeddings",
    values: [row],
    format: "JSONEachRow",
  });

  return row;
}

export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vector size mismatch in dotProduct");
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result += a[i] * b[i];
  }
  return result;
}

export function vectorNorm(a: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * a[i];
  }
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const normA = vectorNorm(a);
  const normB = vectorNorm(b);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct(a, b) / (normA * normB);
}