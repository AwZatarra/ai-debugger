import { getLatestLlmCauseRanking } from "./llmCauseRankingStore";
import { listLlmCauseRankingFeedbackByIncident } from "./llmCauseRankingFeedback";

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function getLlmCauseRankingEvaluation(incidentId: string) {
  const [latestRanking, feedbackList] = await Promise.all([
    getLatestLlmCauseRanking(incidentId),
    listLlmCauseRankingFeedbackByIncident(incidentId),
  ]);

  if (!latestRanking) {
    return null;
  }

  const latestFeedback = feedbackList[0] || null;
  const topCause = latestRanking.ranked_causes?.[0] || null;

  const llmTopRank = topCause?.rank || 0;
  const llmTopCause = topCause?.cause || "";
  const humanSelectedRank = latestFeedback?.selected_rank || 0;
  const humanSelectedCause = latestFeedback?.selected_cause || "";
  const verdict = latestFeedback?.verdict || "no_feedback";

  const top1MatchByRank =
    Boolean(latestFeedback) &&
    llmTopRank > 0 &&
    humanSelectedRank > 0 &&
    llmTopRank === humanSelectedRank;

  const top1MatchByCause =
    Boolean(latestFeedback) &&
    normalizeText(llmTopCause) !== "" &&
    normalizeText(humanSelectedCause) !== "" &&
    normalizeText(llmTopCause) === normalizeText(humanSelectedCause);

  const top1Match = top1MatchByRank || top1MatchByCause;

  let summary = "No human feedback available yet.";
  if (latestFeedback) {
    if (verdict === "correct" && top1Match) {
      summary = "The LLM top-ranked cause was confirmed as correct by the reviewer.";
    } else if (verdict === "correct" && !top1Match) {
      summary =
        "The reviewer marked the ranking as correct overall, but did not select the LLM top-ranked cause directly.";
    } else if (verdict === "partially_correct") {
      summary =
        "The reviewer marked the ranking as partially correct; some signals were useful but the final ranking needs refinement.";
    } else if (verdict === "incorrect") {
      summary =
        "The reviewer marked the ranking as incorrect; the suggested ranking did not match the confirmed root cause.";
    }
  }

  return {
    incident_id: incidentId,
    ranking: {
      analyzed_at: latestRanking.analyzed_at,
      llm_model: latestRanking.llm_model,
      top_rank: llmTopRank,
      top_cause: llmTopCause,
      ranked_causes_count: latestRanking.ranked_causes?.length || 0,
    },
    feedback: latestFeedback
      ? {
          reviewed_at: latestFeedback.reviewed_at,
          reviewer: latestFeedback.reviewer,
          verdict: latestFeedback.verdict,
          selected_rank: latestFeedback.selected_rank,
          selected_cause: latestFeedback.selected_cause,
          actual_root_cause: latestFeedback.actual_root_cause,
          actual_fix: latestFeedback.actual_fix,
          notes: latestFeedback.notes,
        }
      : null,
    evaluation: {
      has_feedback: Boolean(latestFeedback),
      top1_match_by_rank: top1MatchByRank,
      top1_match_by_cause: top1MatchByCause,
      top1_match: top1Match,
      summary,
    },
  };
}