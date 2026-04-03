import { buildIncidentContext } from "./contextBuilder";
import { findSimilarIncidents } from "./similarIncidents";
import { getKnowledgeForIncident } from "./knowledge";

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

type CauseCandidate = {
  cause: string;
  score: number;
  source: string;
  reasoning: string[];
  supporting_evidence: string[];
};

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeCauseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s/|-]/g, "")
    .trim();
}

function addCandidate(
  map: Map<string, CauseCandidate>,
  cause: string,
  score: number,
  source: string,
  reasoning: string[],
  supportingEvidence: string[]
) {
  const cleanCause = cause.trim();
  if (!cleanCause) return;

  const key = normalizeCauseText(cleanCause);
  const existing = map.get(key);

  if (!existing) {
    map.set(key, {
      cause: cleanCause,
      score,
      source,
      reasoning: [...reasoning],
      supporting_evidence: [...supportingEvidence],
    });
    return;
  }

  existing.score += Math.round(score * 0.5);
  existing.source = `${existing.source}+${source}`;

  for (const item of reasoning) {
    if (!existing.reasoning.includes(item)) {
      existing.reasoning.push(item);
    }
  }

  for (const item of supportingEvidence) {
    if (!existing.supporting_evidence.includes(item)) {
      existing.supporting_evidence.push(item);
    }
  }
}

function buildCauseFromErrorLog(log: ContextLog): string {
  const routePart = log.route ? ` on ${log.route}` : "";
  const errorPart = log.error_code || log.error_type || "unknown error";

  return `${log.service} failed first${routePart} with ${errorPart}`;
}

function findEarliestError(logs: ContextLog[], primaryService: string): ContextLog | null {
  const errorLogs = logs
    .filter((log) => log.level === "error")
    .sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

  if (errorLogs.length === 0) return null;

  const primaryError = errorLogs.find((log) => log.service === primaryService);

  if (primaryError && errorLogs[0].service === primaryService) {
    return primaryError;
  }

  return errorLogs[0];
}

function buildTimeoutCause(service: string, route: string, errorCode: string) {
  return `${service} likely timing out on ${route || "unknown route"} with ${errorCode || "timeout-related error"}`;
}

function extractHeuristicCandidates(context: any): CauseCandidate[] {
  const incident = context.incident;
  const evidence = context.evidence || {};
  const traceLogs = (context.trace_logs || []) as ContextLog[];
  const correlatedErrors = (context.correlated_errors || []) as ContextLog[];

  const candidates: CauseCandidate[] = [];

  const earliest = findEarliestError(correlatedErrors, incident.primary_service);

  if (earliest) {
    candidates.push({
      cause: buildCauseFromErrorLog(earliest),
      score: earliest.service === incident.primary_service ? 95 : 90,
      source: "heuristic",
      reasoning: [
        earliest.service === incident.primary_service
          ? "earliest correlated error came from the primary service"
          : "earliest correlated error came from another service before the primary service",
      ],
      supporting_evidence: [
        `timestamp=${earliest.timestamp}`,
        `service=${earliest.service}`,
        `route=${earliest.route || ""}`,
        `error_code=${earliest.error_code || ""}`,
        `error_type=${earliest.error_type || ""}`,
        `message=${earliest.message || ""}`,
      ],
    });
  }

  if ((evidence.error_code || "").includes("TIMEOUT")) {
    candidates.push({
      cause: buildTimeoutCause(
        incident.primary_service,
        evidence.route || "unknown route",
        evidence.error_code || incident.error_type || "timeout"
      ),
      score: 85,
      source: "heuristic",
      reasoning: ["incident evidence contains timeout-related signals"],
      supporting_evidence: [
        `primary_service=${incident.primary_service}`,
        `route=${evidence.route || ""}`,
        `error_code=${evidence.error_code || ""}`,
        `sample_message=${evidence.sample_message || ""}`,
      ],
    });
  }

  const upstreamHint = traceLogs.find((log) => {
    if (log.service !== incident.primary_service && log.level === "error") return true;

    const payload = safeJsonParse(log.payload || "{}");
    return payload?.upstream_status || payload?.upstream_data?.error;
  });

  if (upstreamHint) {
    const payload = safeJsonParse(upstreamHint.payload || "{}");
    const upstreamError =
      payload?.upstream_data?.error || upstreamHint.error_code || upstreamHint.error_type || "upstream failure";

    candidates.push({
      cause: `${upstreamHint.service} likely triggered the failure chain (${upstreamError})`,
      score: 75,
      source: "heuristic",
      reasoning: ["trace contains upstream/downstream propagation signals"],
      supporting_evidence: [
        `service=${upstreamHint.service}`,
        `route=${upstreamHint.route || ""}`,
        `error=${upstreamError}`,
        `message=${upstreamHint.message || ""}`,
      ],
    });
  }

  return candidates;
}

function extractCandidatesFromSimilarIncidents(similarResult: any): CauseCandidate[] {
  const items = similarResult?.similar_incidents || [];
  const candidates: CauseCandidate[] = [];

  for (const item of items.slice(0, 10)) {
    const evidenceBits = [
      `incident_id=${item.incident_id}`,
      `title=${item.title || ""}`,
      `primary_service=${item.primary_service || ""}`,
      `error_type=${item.error_type || ""}`,
      `similarity_score=${item.similarity_score || 0}`,
    ];

    if (item.primary_service && item.error_message) {
      candidates.push({
        cause: `${item.primary_service} likely failed in a similar pattern (${item.error_message})`,
        score: Math.min(70, Math.max(20, Math.round((item.similarity_score || 0) * 0.4))),
        source: "similar_incidents",
        reasoning: [
          item.similarity_reason || "historically similar incident",
        ],
        supporting_evidence: evidenceBits,
      });
    }

    if (item.primary_service && item.error_type) {
      candidates.push({
        cause: `${item.primary_service} likely involved ${item.error_type} under a similar failure pattern`,
        score: Math.min(60, Math.max(15, Math.round((item.similarity_score || 0) * 0.3))),
        source: "similar_incidents",
        reasoning: [
          "candidate inferred from similar incident service and error type",
        ],
        supporting_evidence: evidenceBits,
      });
    }
  }

  return candidates;
}

function inferCauseFromKnowledgeText(chunk: any): string | null {
  const text = String(chunk.text || "").trim();
  const lower = text.toLowerCase();

  if (!text) return null;

  if (lower.includes("connection pool saturation")) {
    return `${chunk.service || "service"} may be experiencing connection pool saturation`;
  }

  if (lower.includes("slow queries")) {
    return `${chunk.service || "service"} may be affected by slow queries`;
  }

  if (lower.includes("db connectivity")) {
    return `${chunk.service || "service"} may be affected by DB connectivity issues`;
  }

  if (lower.includes("retry policy")) {
    return `${chunk.service || "service"} may need retry policy review due to repeated dependency failures`;
  }

  if (lower.includes("propagated dependency failure")) {
    return `${chunk.service || "service"} may be showing a propagated dependency failure rather than the original root cause`;
  }

  if (lower.includes("timeout")) {
    return `${chunk.service || "service"} may be failing due to timeout-related dependency or database latency`;
  }

  return null;
}

function extractCandidatesFromKnowledge(knowledgeResult: any): CauseCandidate[] {
  const matches = knowledgeResult?.matches || [];
  const candidates: CauseCandidate[] = [];

  for (const match of matches.slice(0, 10)) {
    const inferredCause = inferCauseFromKnowledgeText(match);
    if (!inferredCause) continue;

    const matchScore = match.match_score || 0;

    candidates.push({
      cause: inferredCause,
      score: Math.min(65, Math.max(15, Math.round(matchScore * 0.35))),
      source: "knowledge",
      reasoning: [
        match.match_reason || "knowledge match aligned with the incident",
      ],
      supporting_evidence: [
        `chunk_id=${match.chunk_id}`,
        `source_name=${match.source_name || ""}`,
        `service=${match.service || ""}`,
        `route=${match.route || ""}`,
        `error_code=${match.error_code || ""}`,
        `match_score=${match.match_score || 0}`,
      ],
    });
  }

  return candidates;
}

export async function getCauseRankingForIncident(incidentId: string) {
  const context = await buildIncidentContext(incidentId);
  if (!context) {
    return null;
  }

  const [similarResult, knowledgeResult] = await Promise.all([
    findSimilarIncidents(incidentId),
    getKnowledgeForIncident(incidentId),
  ]);

  const candidateMap = new Map<string, CauseCandidate>();

  const allCandidates = [
    ...extractHeuristicCandidates(context),
    ...extractCandidatesFromSimilarIncidents(similarResult),
    ...extractCandidatesFromKnowledge(knowledgeResult),
  ];

  for (const candidate of allCandidates) {
    addCandidate(
      candidateMap,
      candidate.cause,
      candidate.score,
      candidate.source,
      candidate.reasoning,
      candidate.supporting_evidence
    );
  }

  const ranked = Array.from(candidateMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((candidate, index) => ({
      rank: index + 1,
      cause: candidate.cause,
      score: candidate.score,
      source: candidate.source,
      reasoning: candidate.reasoning,
      supporting_evidence: candidate.supporting_evidence,
    }));

  return {
    incident: {
      incident_id: context.incident.incident_id,
      title: context.incident.title,
      primary_service: context.incident.primary_service,
      fingerprint: context.incident.fingerprint,
      trace_id: context.incident.trace_id,
      error_type: context.incident.error_type,
      evidence: context.evidence,
    },
    inputs: {
      heuristic_candidates: extractHeuristicCandidates(context).length,
      similar_incident_candidates: (similarResult?.similar_incidents || []).length,
      knowledge_candidates: (knowledgeResult?.matches || []).length,
    },
    ranked_causes: ranked,
  };
}