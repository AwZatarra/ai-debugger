import express from "express";
import dotenv from "dotenv";
import { createClient } from "@clickhouse/client";

dotenv.config({ path: "../../.env" });

const app = express();
app.use(express.json({ limit: "5mb" }));

const client = createClient({
  url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER || "aiuser",
  password: process.env.CLICKHOUSE_PASSWORD || "aipass123",
});

type LogRow = {
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

app.post("/ingest-log", async (req, res) => {
  try {
    const body: LogRow = req.body;

    console.log("Incoming log:", body);

    await client.insert({
      table: "observability.logs",
      values: [body],
      format: "JSONEachRow",
    });

    console.log("Inserted into ClickHouse");

    res.json({ ok: true });
  } catch (error: any) {
    console.error("Failed to ingest log:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "log-ingestor" });
});

app.listen(3010, () => {
  console.log("log-ingestor running on http://localhost:3010");
});