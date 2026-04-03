import { clickhouse } from "./clickhouse";
import { getLlmCauseRankingEvaluation } from "./llmCauseRankingEvaluation";

type DistinctIncidentRow = {
  incident_id: string;
};

type FeedbackVerdictRow = {
  verdict: string;
  count: number;
};

export async function getLlmCauseRankingStats() {
  const rankingsIncidentSet = await clickhouse.query({
    query: `
      SELECT DISTINCT incident_id
      FROM observability.llm_cause_rankings
      ORDER BY incident_id
    `,
    format: "JSONEachRow",
  });

  const feedbackIncidentSet = await clickhouse.query({
    query: `
      SELECT DISTINCT incident_id
      FROM observability.llm_cause_ranking_feedback
      ORDER BY incident_id
    `,
    format: "JSONEachRow",
  });

  const totalRankingsSet = await clickhouse.query({
    query: `
      SELECT count() AS count
      FROM observability.llm_cause_rankings
    `,
    format: "JSONEachRow",
  });

  const totalFeedbackSet = await clickhouse.query({
    query: `
      SELECT count() AS count
      FROM observability.llm_cause_ranking_feedback
    `,
    format: "JSONEachRow",
  });

  const verdictSet = await clickhouse.query({
    query: `
      SELECT
        verdict,
        count() AS count
      FROM observability.llm_cause_ranking_feedback
      GROUP BY verdict
      ORDER BY verdict
    `,
    format: "JSONEachRow",
  });

  const [rankingIncidents, feedbackIncidents, totalRankingsRows, totalFeedbackRows, verdictRows] =
    await Promise.all([
      rankingsIncidentSet.json<DistinctIncidentRow>(),
      feedbackIncidentSet.json<DistinctIncidentRow>(),
      totalRankingsSet.json<{ count: number }>(),
      totalFeedbackSet.json<{ count: number }>(),
      verdictSet.json<FeedbackVerdictRow>(),
    ]);

  const uniqueRankingIncidentIds = rankingIncidents.map((row) => row.incident_id);
  const uniqueFeedbackIncidentIds = feedbackIncidents.map((row) => row.incident_id);

  let top1Matches = 0;
  let evaluatedRankings = 0;

  for (const incidentId of uniqueFeedbackIncidentIds) {
    const evaluation = await getLlmCauseRankingEvaluation(incidentId);

    if (!evaluation || !evaluation.evaluation.has_feedback) {
      continue;
    }

    evaluatedRankings += 1;

    if (evaluation.evaluation.top1_match) {
      top1Matches += 1;
    }
  }

  const verdictCounts = {
    correct: 0,
    partially_correct: 0,
    incorrect: 0,
  };

  for (const row of verdictRows) {
    const verdict = String(row.verdict || "");
    const count = Number(row.count || 0);

    if (verdict === "correct") {
      verdictCounts.correct = count;
    } else if (verdict === "partially_correct") {
      verdictCounts.partially_correct = count;
    } else if (verdict === "incorrect") {
      verdictCounts.incorrect = count;
    }
  }

  const top1Accuracy =
    evaluatedRankings > 0 ? Number((top1Matches / evaluatedRankings).toFixed(4)) : 0;

  return {
    total_rankings: Number(totalRankingsRows[0]?.count || 0),
    total_feedback: Number(totalFeedbackRows[0]?.count || 0),
    incidents_with_rankings: uniqueRankingIncidentIds.length,
    incidents_with_feedback: uniqueFeedbackIncidentIds.length,
    evaluated_rankings: evaluatedRankings,
    verdict_counts: verdictCounts,
    top1_matches: top1Matches,
    top1_accuracy: top1Accuracy,
  };
}