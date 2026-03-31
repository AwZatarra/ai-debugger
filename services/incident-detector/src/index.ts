import express from "express";
import dotenv from "dotenv";
import { clickhouse } from "./clickhouse";
import { detectIncidents } from "./detector";
import { buildIncidentContext } from "./contextBuilder";
import { analyzeIncident } from "./analyzer";
import { analyzeIncidentWithLLM } from "./llmAnalyzer";
import { buildAnalysisSummary } from "./analysisSummary";
import { findSimilarIncidents } from "./similarIncidents";
import {
  createKnowledgeChunk,
  listKnowledgeChunks,
  getKnowledgeForIncident,
} from "./knowledge";
import cors from "cors";

dotenv.config({ path: "../../.env" });

const app = express();
app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "incident-detector" });
});

app.post("/detect", async (_req, res) => {
  try {
    const result = await detectIncidents();
    res.json({ ok: true, result });
  } catch (error: any) {
    console.error("Detection error:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/incidents", async (_req, res) => {
  try {
    const resultSet = await clickhouse.query({
      query: `
        SELECT
          incident_id,
          created_at,
          status,
          fingerprint,
          title,
          primary_service,
          severity,
          trace_id,
          error_type,
          error_message,
          evidence_json
        FROM observability.incidents
        ORDER BY created_at DESC
        LIMIT 100
      `,
      format: "JSONEachRow",
    });

    const rows = await resultSet.json();
    res.json({ ok: true, incidents: rows });
  } catch (error: any) {
    console.error("List incidents error:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/incidents/:id/context", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const context = await buildIncidentContext(incidentId);

    if (!context) {
      return res.status(404).json({
        ok: false,
        error: "Incident not found",
      });
    }

    res.json({
      ok: true,
      context,
    });
  } catch (error: any) {
    console.error("Build context error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/incidents/:id/analyze", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await analyzeIncident(incidentId);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Incident not found",
      });
    }

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Analyze incident error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/incidents/:id/analyze-llm", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await analyzeIncidentWithLLM(incidentId);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Incident not found",
      });
    }

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Analyze incident with LLM error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/analysis-summary", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const summary = await buildAnalysisSummary(incidentId);

    res.json({
      ok: true,
      summary,
    });
  } catch (error: any) {
    console.error("Analysis summary error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/similar", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await findSimilarIncidents(incidentId);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Incident not found",
      });
    }

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Find similar incidents error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/knowledge", async (req, res) => {
  try {
    const { source_type, source_name, service, route, error_code, tags, text } = req.body;

    if (!source_type || !source_name || !text) {
      return res.status(400).json({
        ok: false,
        error: "source_type, source_name and text are required",
      });
    }

    const row = await createKnowledgeChunk({
      source_type,
      source_name,
      service,
      route,
      error_code,
      tags,
      text,
    });

    res.json({
      ok: true,
      knowledge_chunk: row,
    });
  } catch (error: any) {
    console.error("Create knowledge chunk error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/knowledge", async (_req, res) => {
  try {
    const rows = await listKnowledgeChunks();
    res.json({
      ok: true,
      knowledge_chunks: rows,
    });
  } catch (error: any) {
    console.error("List knowledge error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/knowledge", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await getKnowledgeForIncident(incidentId);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Incident not found",
      });
    }

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Incident knowledge lookup error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.listen(3020, () => {
  console.log("incident-detector running on http://localhost:3020");
});