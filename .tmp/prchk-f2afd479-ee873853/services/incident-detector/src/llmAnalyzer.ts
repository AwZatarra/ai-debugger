import { clickhouse } from "./clickhouse";
import { buildIncidentContext } from "./contextBuilder";
import { openai, OPENAI_MODEL } from "./openaiClient";
import { findSimilarIncidents } from "./similarIncidents";
import { getKnowledgeForIncident } from "./knowledge";

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

type StructuredRcaOutput = {
  probable_root_cause: string;
  confidence: number;
  explanation: string;
  suggested_fix: string;
  suggested_patch: string;
  derived_symptoms: string[];
  evidence_points: string[];
  used_similar_incidents: string[];
  used_knowledge_chunks: string[];
};

async function existingLlmRcaReport(incidentId: string): Promise<RCAReport | null> {
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
        AND llm_model != 'heuristic-v1'
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

async function findRelatedIncidentsByTraceId(traceId: string): Promise<string[]> {
  if (!traceId) return [];

  const resultSet = await clickhouse.query({
    query: `
      SELECT incident_id
      FROM observability.incidents
      WHERE trace_id = {trace_id:String}
      ORDER BY created_at DESC
      LIMIT 10
    `,
    query_params: {
      trace_id: traceId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{ incident_id: string }>();
  return rows.map((row) => row.incident_id);
}

function compactLog(log: any) {
  return {
    timestamp: log.timestamp,
    service: log.service,
    level: log.level,
    message: log.message,
    route: log.route,
    error_code: log.error_code,
    error_type: log.error_type,
    trace_id: log.trace_id,
    payload: log.payload,
  };
}

function compactSimilarIncident(item: any) {
  return {
    incident_id: item.incident_id,
    title: item.title,
    primary_service: item.primary_service,
    severity: item.severity,
    fingerprint: item.fingerprint,
    error_type: item.error_type,
    error_message: item.error_message,
    similarity_reason: item.similarity_reason,
    similarity_score: item.similarity_score,
  };
}

function compactKnowledgeMatch(item: any) {
  return {
    chunk_id: item.chunk_id,
    source_type: item.source_type,
    source_name: item.source_name,
    service: item.service,
    route: item.route,
    error_code: item.error_code,
    text: item.text,
    match_reason: item.match_reason,
    match_score: item.match_score,
  };
}

export async function analyzeIncidentWithLLM(incidentId: string) {
  const existing = await existingLlmRcaReport(incidentId);
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

  const relatedIncidentIds = await findRelatedIncidentsByTraceId(
    context.incident.trace_id
  );

  const similarIncidentsResult = await findSimilarIncidents(incidentId);
  const knowledgeResult = await getKnowledgeForIncident(incidentId);

  const analysisInput = {
    summary: context.summary,
    evidence: context.evidence,
    trace_logs: (context.trace_logs || []).slice(0, 20).map(compactLog),
    correlated_errors: (context.correlated_errors || []).slice(0, 10).map(compactLog),
    nearby_logs: (context.nearby_logs || []).slice(0, 20).map(compactLog),
    similar_incidents: (similarIncidentsResult?.similar_incidents || [])
      .slice(0, 10)
      .map(compactSimilarIncident),
    knowledge_matches: (knowledgeResult?.matches || [])
      .slice(0, 10)
      .map(compactKnowledgeMatch),
  };

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions:
    "You are a senior production reliability engineer specialized in root cause analysis for distributed systems. " +
    "Use only the supplied evidence. Do not invent facts. " +
    "Prefer the earliest failing service in the same trace as the root cause unless the evidence clearly contradicts that. " +
    "Use similar incidents as supporting context, not as proof by themselves. " +
    "Use knowledge matches and runbooks to strengthen suggested fixes when they align with the incident evidence. " +
    "Differentiate root cause from propagated symptoms in upstream services. " +
    "Return concise, precise engineering analysis.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Analyze this incident context and return a structured RCA.\n\n" +
              JSON.stringify(analysisInput, null, 2),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "incident_rca",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            probable_root_cause: { type: "string" },
            confidence: { type: "number" },
            explanation: { type: "string" },
            suggested_fix: { type: "string" },
            suggested_patch: { type: "string" },
            derived_symptoms: {
              type: "array",
              items: { type: "string" },
            },
            evidence_points: {
              type: "array",
              items: { type: "string" },
            },
            used_similar_incidents: {
              type: "array",
              items: { type: "string" },
            },
            used_knowledge_chunks: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "probable_root_cause",
            "confidence",
            "explanation",
            "suggested_fix",
            "suggested_patch",
            "derived_symptoms",
            "evidence_points",
            "used_similar_incidents",
            "used_knowledge_chunks",
          ],
        },
      },
    },
  });

  const raw = response.output_text;
  const parsed = JSON.parse(raw) as StructuredRcaOutput;

  const report: RCAReport = {
    incident_id: context.incident.incident_id,
    analyzed_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    probable_root_cause: parsed.probable_root_cause,
    confidence: parsed.confidence,
    explanation:
      parsed.explanation +
      (parsed.evidence_points?.length
        ? ` Evidence: ${parsed.evidence_points.join(" | ")}`
        : ""),
    suggested_fix: parsed.suggested_fix,
    suggested_patch: parsed.suggested_patch,
    related_incidents: JSON.stringify(relatedIncidentIds),
    llm_model: OPENAI_MODEL,
  };

  await clickhouse.insert({
    table: "observability.rca_reports",
    values: [report],
    format: "JSONEachRow",
  });

  return {
    already_exists: false,
    report,
    llm_details: {
      derived_symptoms: parsed.derived_symptoms,
      evidence_points: parsed.evidence_points,
      used_similar_incidents: parsed.used_similar_incidents,
      used_knowledge_chunks: parsed.used_knowledge_chunks,
    },
    context_summary: {
      trace_id: context.incident.trace_id,
      primary_service: context.incident.primary_service,
      correlated_error_count: (context.correlated_errors || []).length,
      trace_log_count: (context.trace_logs || []).length,
      similar_incident_count: (similarIncidentsResult?.similar_incidents || []).length,
      knowledge_match_count: (knowledgeResult?.matches || []).length,
    },
  };
}