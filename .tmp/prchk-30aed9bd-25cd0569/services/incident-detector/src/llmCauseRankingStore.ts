import { clickhouse } from "./clickhouse";

type StoredLlmCauseRankingRow = {
  incident_id: string;
  analyzed_at: string;
  llm_model: string;
  summary: string;
  ranked_causes_json: string;
};

export async function getLatestLlmCauseRanking(incidentId: string) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        incident_id,
        analyzed_at,
        llm_model,
        summary,
        ranked_causes_json
      FROM observability.llm_cause_rankings
      WHERE incident_id = {incident_id:UUID}
      ORDER BY analyzed_at DESC
      LIMIT 1
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<StoredLlmCauseRankingRow>();
  const row = rows[0];

  if (!row) {
    return null;
  }

  let rankedCauses: any[] = [];
  try {
    rankedCauses = JSON.parse(row.ranked_causes_json || "[]");
  } catch {
    rankedCauses = [];
  }

  return {
    incident_id: row.incident_id,
    analyzed_at: row.analyzed_at,
    llm_model: row.llm_model,
    summary: row.summary,
    ranked_causes: rankedCauses,
  };
}

export async function saveLlmCauseRanking(input: {
  incident_id: string;
  llm_model: string;
  summary: string;
  ranked_causes: any[];
}) {
  const row: StoredLlmCauseRankingRow = {
    incident_id: input.incident_id,
    analyzed_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    llm_model: input.llm_model,
    summary: input.summary,
    ranked_causes_json: JSON.stringify(input.ranked_causes || []),
  };

  await clickhouse.insert({
    table: "observability.llm_cause_rankings",
    values: [row],
    format: "JSONEachRow",
  });

  return {
    incident_id: row.incident_id,
    analyzed_at: row.analyzed_at,
    llm_model: row.llm_model,
    summary: row.summary,
    ranked_causes: input.ranked_causes || [],
  };
}

export async function listLlmCauseRankingsByIncident(incidentId: string) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        incident_id,
        analyzed_at,
        llm_model,
        summary,
        ranked_causes_json
      FROM observability.llm_cause_rankings
      WHERE incident_id = {incident_id:UUID}
      ORDER BY analyzed_at DESC
      LIMIT 20
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<StoredLlmCauseRankingRow>();

  return rows.map((row) => {
    let rankedCauses: any[] = [];
    try {
      rankedCauses = JSON.parse(row.ranked_causes_json || "[]");
    } catch {
      rankedCauses = [];
    }

    return {
      incident_id: row.incident_id,
      analyzed_at: row.analyzed_at,
      llm_model: row.llm_model,
      summary: row.summary,
      ranked_causes: rankedCauses,
    };
  });
}