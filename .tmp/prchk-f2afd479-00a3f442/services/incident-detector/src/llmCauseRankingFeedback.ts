import { randomUUID } from "crypto";
import { clickhouse } from "./clickhouse";

type LlmCauseRankingFeedbackRow = {
  feedback_id: string;
  incident_id: string;
  reviewed_at: string;
  reviewer: string;
  verdict: string;
  selected_rank: number;
  selected_cause: string;
  actual_root_cause: string;
  actual_fix: string;
  notes: string;
};

function normalizeVerdict(value: string): string {
  const clean = String(value || "").trim().toLowerCase();

  if (["correct", "partially_correct", "incorrect"].includes(clean)) {
    return clean;
  }

  throw new Error("verdict must be one of: correct, partially_correct, incorrect");
}

export async function createLlmCauseRankingFeedback(input: {
  incident_id: string;
  reviewer?: string;
  verdict: string;
  selected_rank?: number;
  selected_cause?: string;
  actual_root_cause?: string;
  actual_fix?: string;
  notes?: string;
}) {
  const row: LlmCauseRankingFeedbackRow = {
    feedback_id: randomUUID(),
    incident_id: input.incident_id,
    reviewed_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    reviewer: String(input.reviewer || "anonymous").trim(),
    verdict: normalizeVerdict(input.verdict),
    selected_rank: Number.isFinite(input.selected_rank) ? Number(input.selected_rank) : 0,
    selected_cause: String(input.selected_cause || "").trim(),
    actual_root_cause: String(input.actual_root_cause || "").trim(),
    actual_fix: String(input.actual_fix || "").trim(),
    notes: String(input.notes || "").trim(),
  };

  await clickhouse.insert({
    table: "observability.llm_cause_ranking_feedback",
    values: [row],
    format: "JSONEachRow",
  });

  return row;
}

export async function listLlmCauseRankingFeedbackByIncident(incidentId: string) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        feedback_id,
        incident_id,
        reviewed_at,
        reviewer,
        verdict,
        selected_rank,
        selected_cause,
        actual_root_cause,
        actual_fix,
        notes
      FROM observability.llm_cause_ranking_feedback
      WHERE incident_id = {incident_id:UUID}
      ORDER BY reviewed_at DESC
      LIMIT 100
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  return await resultSet.json<LlmCauseRankingFeedbackRow>();
}