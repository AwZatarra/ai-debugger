import { buildIncidentContext } from "./contextBuilder";
import { findSimilarIncidents } from "./similarIncidents";
import { getKnowledgeForIncident } from "./knowledge";
import { getCauseRankingForIncident } from "./causeRanker";
import { openai, OPENAI_MODEL } from "./openaiClient";
import {
  getLatestLlmCauseRanking,
  saveLlmCauseRanking,
} from "./llmCauseRankingStore";

type LlmRankedCause = {
  rank: number;
  cause: string;
  confidence: number;
  classification: "root_cause_candidate" | "propagated_symptom" | "supporting_hypothesis";
  why: string;
  evidence_points: string[];
  based_on_candidates: string[];
};

type LlmCauseRankingResponse = {
  summary: string;
  ranked_causes: LlmRankedCause[];
};

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
    heuristic_score: item.heuristic_score,
    semantic_score: item.semantic_score,
    similarity_score: item.similarity_score,
  };
}

function compactKnowledgeMatch(item: any) {
  return {
    chunk_id: item.chunk_id,
    source_name: item.source_name,
    service: item.service,
    route: item.route,
    error_code: item.error_code,
    match_reason: item.match_reason,
    heuristic_score: item.heuristic_score,
    semantic_score: item.semantic_score,
    match_score: item.match_score,
    text: item.text,
  };
}

function compactRankedCause(item: any) {
  return {
    rank: item.rank,
    cause: item.cause,
    score: item.score,
    source: item.source,
    reasoning: item.reasoning,
    supporting_evidence: item.supporting_evidence,
  };
}

export async function getLlmCauseRankingForIncident(incidentId: string) {
  const existing = await getLatestLlmCauseRanking(incidentId);

  const incidentContext = await buildIncidentContext(incidentId);

    if (existing) {
    return {
        incident: incidentContext
        ? {
            incident_id: incidentContext.incident.incident_id,
            title: incidentContext.incident.title,
            primary_service: incidentContext.incident.primary_service,
            fingerprint: incidentContext.incident.fingerprint,
            trace_id: incidentContext.incident.trace_id,
            error_type: incidentContext.incident.error_type,
            }
        : { incident_id: existing.incident_id },
        llm_model: existing.llm_model,
        analyzed_at: existing.analyzed_at,
        summary: existing.summary,
        ranked_causes: existing.ranked_causes,
        cached: true,
    };
    }

  const [context, similarResult, knowledgeResult, deterministicRanking] = await Promise.all([
    buildIncidentContext(incidentId),
    findSimilarIncidents(incidentId),
    getKnowledgeForIncident(incidentId),
    getCauseRankingForIncident(incidentId),
  ]);

  if (!context || !deterministicRanking) {
    return null;
  }

  const incident = context.incident;

  const llmInput = {
    incident: {
      incident_id: incident.incident_id,
      title: incident.title,
      primary_service: incident.primary_service,
      severity: incident.severity,
      fingerprint: incident.fingerprint,
      trace_id: incident.trace_id,
      error_type: incident.error_type,
      error_message: incident.error_message,
    },
    evidence: context.evidence,
    trace_logs: (context.trace_logs || []).slice(0, 20).map(compactLog),
    correlated_errors: (context.correlated_errors || []).slice(0, 10).map(compactLog),
    similar_incidents: (similarResult?.similar_incidents || [])
      .slice(0, 10)
      .map(compactSimilarIncident),
    knowledge_matches: (knowledgeResult?.matches || [])
      .slice(0, 10)
      .map(compactKnowledgeMatch),
    deterministic_ranked_causes: (deterministicRanking?.ranked_causes || [])
      .slice(0, 10)
      .map(compactRankedCause),
  };

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions:
      "You are a senior production reliability engineer performing root cause ranking for distributed systems. " +
      "Use only the supplied evidence and candidates. Do not invent incidents, logs, services, routes, or causes. " +
      "Prefer causes directly supported by the incident trace and earliest failing service. " +
      "Treat propagated upstream/downstream symptoms as weaker than direct root cause evidence unless the evidence clearly shows dependency-origin failure. " +
      "Use similar incidents and knowledge chunks as supporting context, not as standalone proof. " +
      "Merge overlapping candidates into cleaner engineering hypotheses. " +
      "Return a concise top ranking with explicit classification and evidence points.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Analyze these root-cause candidates and return an improved ranked list.\n\n" +
              JSON.stringify(llmInput, null, 2),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "llm_cause_ranking",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: {
              type: "string",
            },
            ranked_causes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  rank: { type: "integer" },
                  cause: { type: "string" },
                  confidence: { type: "number" },
                  classification: {
                    type: "string",
                    enum: [
                      "root_cause_candidate",
                      "propagated_symptom",
                      "supporting_hypothesis",
                    ],
                  },
                  why: { type: "string" },
                  evidence_points: {
                    type: "array",
                    items: { type: "string" },
                  },
                  based_on_candidates: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: [
                  "rank",
                  "cause",
                  "confidence",
                  "classification",
                  "why",
                  "evidence_points",
                  "based_on_candidates",
                ],
              },
            },
          },
          required: ["summary", "ranked_causes"],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as LlmCauseRankingResponse;

  const saved = await saveLlmCauseRanking({
    incident_id: incident.incident_id,
    llm_model: OPENAI_MODEL,
    summary: parsed.summary,
    ranked_causes: parsed.ranked_causes,
  });

  return {
    incident: {
      incident_id: incident.incident_id,
      title: incident.title,
      primary_service: incident.primary_service,
      fingerprint: incident.fingerprint,
      trace_id: incident.trace_id,
      error_type: incident.error_type,
    },
    llm_model: saved.llm_model,
    analyzed_at: saved.analyzed_at,
    summary: saved.summary,
    ranked_causes: saved.ranked_causes,
    inputs: {
      deterministic_candidates: (deterministicRanking?.ranked_causes || []).length,
      similar_incidents: (similarResult?.similar_incidents || []).length,
      knowledge_matches: (knowledgeResult?.matches || []).length,
      correlated_errors: (context.correlated_errors || []).length,
    },
    cached: false,
  };
}