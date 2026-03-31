import { randomUUID } from "crypto";
import { clickhouse } from "./clickhouse";

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

  return row;
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

type KnowledgeMatch = KnowledgeChunk & {
  match_reason: string;
  match_score: number;
};

function computeKnowledgeScore(
  incident: IncidentRow,
  evidence: any,
  chunk: KnowledgeChunk
): KnowledgeMatch | null {
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

  if (chunk.text.toLowerCase().includes((incident.error_type || "").toLowerCase()) && incident.error_type) {
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

  if (score === 0) {
    return null;
  }

  return {
    ...chunk,
    match_reason: reasons.join(", "),
    match_score: score,
  };
}

export async function getKnowledgeForIncident(incidentId: string) {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    return null;
  }

  const evidence = safeParseJson(incident.evidence_json);

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
      LIMIT 500
    `,
    format: "JSONEachRow",
  });

  const chunks = await resultSet.json<KnowledgeChunk>();

  const matches = chunks
    .map((chunk) => computeKnowledgeScore(incident, evidence, chunk))
    .filter((item): item is KnowledgeMatch => Boolean(item))
    .sort((a, b) => b.match_score - a.match_score)
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
    total_chunks_scanned: chunks.length,
    matched_count: matches.length,
    matches,
  };
}