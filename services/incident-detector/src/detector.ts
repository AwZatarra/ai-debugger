import { randomUUID } from "crypto";
import { clickhouse } from "./clickhouse";
import { AggregatedErrorRow, IncidentRecord } from "./types";

function buildFingerprint(row: AggregatedErrorRow): string {
  return [
    row.service || "",
    row.route || "",
    row.error_code || "",
    row.error_type || ""
  ].join("|");
}

function buildSeverity(totalErrors: number): string {
  if (totalErrors >= 20) return "critical";
  if (totalErrors >= 10) return "high";
  if (totalErrors >= 5) return "medium";
  return "low";
}

function buildTitle(row: AggregatedErrorRow): string {
  return `${row.service} failing on ${row.route} with ${row.error_code || row.error_type}`;
}

export async function getRecentAggregatedErrors(): Promise<AggregatedErrorRow[]> {
  const query = `
    SELECT
      service,
      route,
      error_code,
      error_type,
      count() AS total_errors,
      any(message) AS sample_message,
      any(trace_id) AS sample_trace,
      min(timestamp) AS first_seen,
      max(timestamp) AS last_seen
    FROM observability.logs
    WHERE timestamp >= now() - INTERVAL 10 MINUTE
      AND level = 'error'
    GROUP BY
      service,
      route,
      error_code,
      error_type
    HAVING total_errors >= 2
    ORDER BY total_errors DESC
  `;

  const resultSet = await clickhouse.query({
    query,
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<AggregatedErrorRow>();
  return rows;
}

async function incidentExists(fingerprint: string): Promise<boolean> {
  const query = `
    SELECT count() AS total
    FROM observability.incidents
    WHERE fingerprint = {fingerprint:String}
      AND status IN ('open', 'investigating')
  `;

  const resultSet = await clickhouse.query({
    query,
    query_params: {
      fingerprint,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{ total: number }>();
  return Number(rows[0]?.total || 0) > 0;
}

export async function createIncidentFromRow(row: AggregatedErrorRow): Promise<IncidentRecord | null> {
  const fingerprint = buildFingerprint(row);

  const exists = await incidentExists(fingerprint);
  if (exists) {
    return null;
  }

  const incident: IncidentRecord = {
    incident_id: randomUUID(),
    created_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    status: "open",
    fingerprint,
    title: buildTitle(row),
    primary_service: row.service,
    severity: buildSeverity(row.total_errors),
    trace_id: row.sample_trace || "",
    error_type: row.error_type || "",
    error_message: row.sample_message || "",
    evidence_json: JSON.stringify({
      service: row.service,
      route: row.route,
      error_code: row.error_code,
      error_type: row.error_type,
      total_errors: row.total_errors,
      sample_message: row.sample_message,
      sample_trace: row.sample_trace,
      first_seen: row.first_seen,
      last_seen: row.last_seen
    }),
  };

  await clickhouse.insert({
    table: "observability.incidents",
    values: [incident],
    format: "JSONEachRow",
  });

  return incident;
}

export async function detectIncidents() {
  const aggregatedErrors = await getRecentAggregatedErrors();

  const created: IncidentRecord[] = [];
  const skipped: string[] = [];

  for (const row of aggregatedErrors) {
    const fingerprint = buildFingerprint(row);
    const incident = await createIncidentFromRow(row);

    if (incident) {
      created.push(incident);
    } else {
      skipped.push(fingerprint);
    }
  }

  return {
    scanned_groups: aggregatedErrors.length,
    created_count: created.length,
    skipped_count: skipped.length,
    created,
    skipped,
  };
}