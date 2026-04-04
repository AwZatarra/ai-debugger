import crypto from "crypto";
import { clickhouse } from "./clickhouse";

type StoredPrActionRow = {
  action_id: string;
  incident_id: string;
  created_at: string;
  repository: string;
  branch_name: string;
  pr_url: string;
  status: string;
  payload_json: string;
};

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: StoredPrActionRow) {
  return {
    action_id: row.action_id,
    incident_id: row.incident_id,
    created_at: row.created_at,
    repository: row.repository,
    branch_name: row.branch_name,
    pr_url: row.pr_url,
    status: row.status,
    payload: safeJsonParse<any>(row.payload_json, {}),
  };
}

export async function createPrAction(input: {
  incident_id: string;
  repository: string;
  branch_name: string;
  pr_url?: string;
  status: string;
  payload: any;
}) {
  const row: StoredPrActionRow = {
    action_id: crypto.randomUUID(),
    incident_id: input.incident_id,
    created_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    repository: input.repository,
    branch_name: input.branch_name,
    pr_url: input.pr_url || "",
    status: input.status,
    payload_json: JSON.stringify(input.payload || {}),
  };

  await clickhouse.insert({
    table: "observability.pr_actions",
    values: [row],
    format: "JSONEachRow",
  });

  return mapRow(row);
}

export async function listPrActionsByIncident(incidentId: string) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        action_id,
        incident_id,
        created_at,
        repository,
        branch_name,
        pr_url,
        status,
        payload_json
      FROM observability.pr_actions
      WHERE incident_id = {incident_id:UUID}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    query_params: {
      incident_id: incidentId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<StoredPrActionRow>();
  return rows.map(mapRow);
}

export async function listPrActionsByProposal(proposalId: string) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        action_id,
        incident_id,
        created_at,
        repository,
        branch_name,
        pr_url,
        status,
        payload_json
      FROM observability.pr_actions
      WHERE JSONExtractString(payload_json, 'proposal_id') = {proposal_id:String}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    query_params: {
      proposal_id: proposalId,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<StoredPrActionRow>();
  return rows.map(mapRow);
}

export async function getLatestPrActionByProposalAndStatus(
  proposalId: string,
  status: string
) {
  const resultSet = await clickhouse.query({
    query: `
      SELECT
        action_id,
        incident_id,
        created_at,
        repository,
        branch_name,
        pr_url,
        status,
        payload_json
      FROM observability.pr_actions
      WHERE JSONExtractString(payload_json, 'proposal_id') = {proposal_id:String}
        AND status = {status:String}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    query_params: {
      proposal_id: proposalId,
      status,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<StoredPrActionRow>();
  const row = rows[0];

  if (!row) {
    return null;
  }

  return mapRow(row);
}