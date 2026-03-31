import { clickhouse } from "./clickhouse";

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

type FinalDecision = {
  final_root_cause: string;
  final_confidence: number;
  final_source: "heuristic" | "llm" | "merged";
  final_explanation: string;
  final_suggested_fix: string;
  final_suggested_patch: string;
};

function normalizeText(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractPrimaryService(rootCause: string): string {
  const match = rootCause.match(/(service-[a-z0-9_-]+)/i);
  return match ? match[1].toLowerCase() : "";
}

function causesAgree(heuristic: RCAReport, llm: RCAReport): boolean {
  const hService = extractPrimaryService(heuristic.probable_root_cause);
  const lService = extractPrimaryService(llm.probable_root_cause);

  if (hService && lService && hService === lService) {
    return true;
  }

  const h = normalizeText(heuristic.probable_root_cause);
  const l = normalizeText(llm.probable_root_cause);

  return h.includes(l) || l.includes(h);
}

async function getReportsForIncident(incidentId: string): Promise<RCAReport[]> {
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
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  return await resultSet.json<RCAReport>();
}

function pickHeuristicReport(reports: RCAReport[]): RCAReport | null {
  return reports.find((r) => r.llm_model === "heuristic-v1") || null;
}

function pickLlmReport(reports: RCAReport[]): RCAReport | null {
  return reports.find((r) => r.llm_model !== "heuristic-v1") || null;
}

function buildFinalDecision(
  heuristic: RCAReport | null,
  llm: RCAReport | null
): FinalDecision | null {
  if (!heuristic && !llm) {
    return null;
  }

  if (heuristic && !llm) {
    return {
      final_root_cause: heuristic.probable_root_cause,
      final_confidence: heuristic.confidence,
      final_source: "heuristic",
      final_explanation: heuristic.explanation,
      final_suggested_fix: heuristic.suggested_fix,
      final_suggested_patch: heuristic.suggested_patch,
    };
  }

  if (!heuristic && llm) {
    return {
      final_root_cause: llm.probable_root_cause,
      final_confidence: llm.confidence,
      final_source: "llm",
      final_explanation: llm.explanation,
      final_suggested_fix: llm.suggested_fix,
      final_suggested_patch: llm.suggested_patch,
    };
  }

  if (!heuristic || !llm) {
    return null;
  }

  const agree = causesAgree(heuristic, llm);

  if (agree) {
    return {
      final_root_cause: llm.probable_root_cause,
      final_confidence: Math.max(heuristic.confidence, llm.confidence),
      final_source: "merged",
      final_explanation:
        `Heuristic and LLM analyses agree on the root cause. ` +
        `Heuristic: ${heuristic.probable_root_cause}. ` +
        `LLM: ${llm.probable_root_cause}.`,
      final_suggested_fix: llm.suggested_fix || heuristic.suggested_fix,
      final_suggested_patch: llm.suggested_patch || heuristic.suggested_patch,
    };
  }

  if (llm.confidence >= heuristic.confidence) {
    return {
      final_root_cause: llm.probable_root_cause,
      final_confidence: llm.confidence,
      final_source: "llm",
      final_explanation:
        `Heuristic and LLM analyses differ. LLM analysis was selected due to higher confidence. ` +
        `Heuristic: ${heuristic.probable_root_cause}. ` +
        `LLM: ${llm.probable_root_cause}.`,
      final_suggested_fix: llm.suggested_fix,
      final_suggested_patch: llm.suggested_patch,
    };
  }

  return {
    final_root_cause: heuristic.probable_root_cause,
    final_confidence: heuristic.confidence,
    final_source: "heuristic",
    final_explanation:
      `Heuristic and LLM analyses differ. Heuristic analysis was selected due to higher confidence. ` +
      `Heuristic: ${heuristic.probable_root_cause}. ` +
      `LLM: ${llm.probable_root_cause}.`,
    final_suggested_fix: heuristic.suggested_fix,
    final_suggested_patch: heuristic.suggested_patch,
  };
}

export async function buildAnalysisSummary(incidentId: string) {
  const reports = await getReportsForIncident(incidentId);

  const heuristic = pickHeuristicReport(reports);
  const llm = pickLlmReport(reports);

  const finalDecision = buildFinalDecision(heuristic, llm);

  return {
    incident_id: incidentId,
    heuristic_report: heuristic,
    llm_report: llm,
    comparison: {
      has_heuristic: Boolean(heuristic),
      has_llm: Boolean(llm),
      agree_on_root_cause:
        heuristic && llm ? causesAgree(heuristic, llm) : false,
    },
    final_decision: finalDecision,
  };
}