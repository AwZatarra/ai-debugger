import { clickhouse } from "./clickhouse";

type StoredPrProposalRow = {
  proposal_id: string;
  incident_id: string;
  created_at: string;
  status: string;
  llm_model: string;
  repository: string;
  target_branch: string;
  title: string;
  summary: string;
  risk_level: string;
  allowlisted_paths_json: string;
  changed_files_json: string;
  checks_json: string;
  payload_json: string;
  reviewed_at?: string | null;
  reviewer: string;
  review_notes: string;
};

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: StoredPrProposalRow) {
  return {
    proposal_id: row.proposal_id,
    incident_id: row.incident_id,
    created_at: row.created_at,
    status: row.status,
    llm_model: row.llm_model,
    repository: row.repository,
    target_branch: row.target_branch,
    title: row.title,
    summary: row.summary,
    risk_level: row.risk_level,
    allowlisted_paths: safeJsonParse<string[]>(row.allowlisted_paths_json, []),
    changed_files: safeJsonParse<any[]>(row.changed_files_json, []),
    checks: safeJsonParse<any[]>(row.checks_json, []),
    proposal: safeJsonParse<any>(row.payload_json, {}),
    reviewed_at: row.reviewed_at || null,
    reviewer: row.reviewer || "",
    review_notes: row.review_notes || "",
  };
}

export async function savePrProposal(input: {
  proposal_id: string;
  incident_id: string;
  status: string;
  llm_model: string;
  repository: string;
  target_branch: string;
  title: string;
  summary: string;
  risk_level: string;
  allowlisted_paths: string[];
  changed_files: any[];
  checks: any[];
  proposal: any;
  reviewed_at?: string | null;
  reviewer?: string;
  review_notes?: string;
}) {
  const row: StoredPrProposalRow = {
    proposal_id: input.proposal_id,
    incident_id: input.incident_id,
    created_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    status: input.status,
    llm_model: input.llm_model,
    repository: input.repository,
    target_branch: input.target_branch,
    title: input.title,
    summary: input.summary,
    risk_level: input.risk_level,
    allowlisted_paths_json: JSON.stringify(input.allowlisted_paths || []),
    changed_files_json: JSON.stringify(input.changed_files || []),
    checks_json: JSON.stringify(input.checks || []),
    payload_json: JSON.stringify(input.proposal || {}),
    reviewed_at: input.reviewed_at ?? null,
    reviewer: input.reviewer || "",
    review_notes: input.review_notes || "",
  };

  await clickhouse.insert({
    table: "observability.pr_proposals",
    values: [row],
    format: "JSONEachRow",
  });

  return mapRow(row);
}

export async function getLatestPrProposalByIncident(incidentId: string) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        proposal_id,
        incident_id,
        created_at,
        status,
        llm_model,
        repository,
        target_branch,
        title,
        summary,
        risk_level,
        allowlisted_paths_json,
        changed_files_json,
        checks_json,
        payload_json,
        reviewed_at,
        reviewer,
        review_notes
      FROM observability.pr_proposals
      WHERE incident_id = {incident_id:UUID}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<StoredPrProposalRow>();
  const row = rows[0];

  if (!row) {
    return null;
  }

  return mapRow(row);
}

export async function listPrProposalsByIncident(incidentId: string) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        proposal_id,
        incident_id,
        created_at,
        status,
        llm_model,
        repository,
        target_branch,
        title,
        summary,
        risk_level,
        allowlisted_paths_json,
        changed_files_json,
        checks_json,
        payload_json,
        reviewed_at,
        reviewer,
        review_notes
      FROM observability.pr_proposals
      WHERE incident_id = {incident_id:UUID}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<StoredPrProposalRow>();
  return rows.map(mapRow);
}

export async function getLatestPrProposalById(proposalId: string) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        proposal_id,
        incident_id,
        created_at,
        status,
        llm_model,
        repository,
        target_branch,
        title,
        summary,
        risk_level,
        allowlisted_paths_json,
        changed_files_json,
        checks_json,
        payload_json,
        reviewed_at,
        reviewer,
        review_notes
      FROM observability.pr_proposals
      WHERE proposal_id = {proposal_id:UUID}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    query_params: {
      proposal_id: proposalId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<StoredPrProposalRow>();
  const row = rows[0];

  if (!row) {
    return null;
  }

  return mapRow(row);
}