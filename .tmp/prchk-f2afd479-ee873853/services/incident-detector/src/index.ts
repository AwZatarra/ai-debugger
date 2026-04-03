import express from "express";
import dotenv from "dotenv";
import { clickhouse } from "./clickhouse";
import { detectIncidents } from "./detector";
import { buildIncidentContext } from "./contextBuilder";
import { analyzeIncident } from "./analyzer";
import { analyzeIncidentWithLLM } from "./llmAnalyzer";
import { buildAnalysisSummary } from "./analysisSummary";
import {
  findSimilarIncidents,
  reindexIncidentEmbedding,
  reindexAllIncidentEmbeddings,
} from "./similarIncidents";
import {
  createKnowledgeChunk,
  listKnowledgeChunks,
  getKnowledgeForIncident,
  reindexKnowledgeChunkEmbedding,
  reindexAllKnowledgeEmbeddings,
} from "./knowledge";
import { getCauseRankingForIncident } from "./causeRanker";
import { getLlmCauseRankingForIncident } from "./llmCauseRanker";
import { listLlmCauseRankingsByIncident } from "./llmCauseRankingStore";
import {
  createLlmCauseRankingFeedback,
  listLlmCauseRankingFeedbackByIncident,
} from "./llmCauseRankingFeedback";
import { getLlmCauseRankingEvaluation } from "./llmCauseRankingEvaluation";
import { getLlmCauseRankingStats } from "./llmCauseRankingStats";
import { generatePrProposalForIncident } from "./prProposalGenerator";
import {
  getLatestPrProposalByIncident,
  listPrProposalsByIncident,
} from "./prProposalStore";
import { reviewPrProposal } from "./prProposalReview";
import { prepareExecutionForProposal } from "./prProposalExecutionPrep";
import { listPrActionsByIncident } from "./prActionStore";
import { generateFileEditsForProposal } from "./prProposalFileEdits";
import { listPrActionsByProposal } from "./prActionStore";
import { validateFileEditsForProposal } from "./prProposalFileEditsValidation";
import { regenerateFileEditsForProposal } from "./prProposalFileEditsRegeneration";
import { runLocalChecksForProposal } from "./prProposalLocalChecks";
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

app.post("/incidents/:id/reindex", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await reindexIncidentEmbedding(incidentId);

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
    console.error("Reindex incident embedding error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/incidents/reindex", async (req, res) => {
  try {
    const limit =
      typeof req.body?.limit === "number" ? req.body.limit : 100;

    const result = await reindexAllIncidentEmbeddings(limit);

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Bulk reindex incident embeddings error:", error.message);
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

app.post("/knowledge/:id/reindex", async (req, res) => {
  try {
    const chunkId = req.params.id;
    const result = await reindexKnowledgeChunkEmbedding(chunkId);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Knowledge chunk not found",
      });
    }

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Reindex knowledge chunk embedding error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/knowledge/reindex", async (req, res) => {
  try {
    const limit =
      typeof req.body?.limit === "number" ? req.body.limit : 100;

    const result = await reindexAllKnowledgeEmbeddings(limit);

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Bulk reindex knowledge embeddings error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/cause-ranking", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await getCauseRankingForIncident(incidentId);

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
    console.error("Cause ranking error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/cause-ranking-llm", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await getLlmCauseRankingForIncident(incidentId);

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
    console.error("LLM cause ranking error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/cause-ranking-llm/history", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const history = await listLlmCauseRankingsByIncident(incidentId);

    res.json({
      ok: true,
      history,
    });
  } catch (error: any) {
    console.error("LLM cause ranking history error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/incidents/:id/llm-cause-ranking/feedback", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const {
      reviewer,
      verdict,
      selected_rank,
      selected_cause,
      actual_root_cause,
      actual_fix,
      notes,
    } = req.body || {};

    if (!verdict) {
      return res.status(400).json({
        ok: false,
        error: "verdict is required",
      });
    }

    const result = await createLlmCauseRankingFeedback({
      incident_id: incidentId,
      reviewer,
      verdict,
      selected_rank,
      selected_cause,
      actual_root_cause,
      actual_fix,
      notes,
    });

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Create LLM cause ranking feedback error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/llm-cause-ranking/feedback", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const feedback = await listLlmCauseRankingFeedbackByIncident(incidentId);

    res.json({
      ok: true,
      feedback,
    });
  } catch (error: any) {
    console.error("List LLM cause ranking feedback error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/llm-cause-ranking/evaluation", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await getLlmCauseRankingEvaluation(incidentId);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "LLM cause ranking not found for this incident",
      });
    }

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("LLM cause ranking evaluation error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/llm-cause-ranking/stats", async (_req, res) => {
  try {
    const result = await getLlmCauseRankingStats();

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("LLM cause ranking stats error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/incidents/:id/pr-proposal", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const {
      repository,
      target_branch,
      allowlisted_paths,
    } = req.body || {};

    const result = await generatePrProposalForIncident({
      incidentId,
      repository,
      target_branch,
      allowlisted_paths,
    });

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
    console.error("Create PR proposal error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/pr-proposal", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const result = await getLatestPrProposalByIncident(incidentId);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "PR proposal not found for this incident",
      });
    }

    res.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    console.error("Get latest PR proposal error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/pr-proposal/history", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const history = await listPrProposalsByIncident(incidentId);

    res.json({
      ok: true,
      history,
    });
  } catch (error: any) {
    console.error("List PR proposal history error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/pr-proposals/:proposalId/approve", async (req, res) => {
  try {
    const proposalId = req.params.proposalId;
    const reviewer =
      typeof req.body?.reviewer === "string" ? req.body.reviewer.trim() : "";
    const notes =
      typeof req.body?.notes === "string" ? req.body.notes.trim() : "";

    if (!reviewer) {
      return res.status(400).json({
        ok: false,
        error: "reviewer is required",
      });
    }

    const reviewed = await reviewPrProposal({
      proposalId,
      decision: "approved",
      reviewer,
      notes,
    });

    if ("error" in reviewed) {
      return res.status(reviewed.statusCode).json({
        ok: false,
        error: reviewed.error,
      });
    }

    res.json({
      ok: true,
      result: reviewed.result,
    });
  } catch (error: any) {
    console.error("Approve PR proposal error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/pr-proposals/:proposalId/reject", async (req, res) => {
  try {
    const proposalId = req.params.proposalId;
    const reviewer =
      typeof req.body?.reviewer === "string" ? req.body.reviewer.trim() : "";
    const notes =
      typeof req.body?.notes === "string" ? req.body.notes.trim() : "";

    if (!reviewer) {
      return res.status(400).json({
        ok: false,
        error: "reviewer is required",
      });
    }

    const reviewed = await reviewPrProposal({
      proposalId,
      decision: "rejected",
      reviewer,
      notes,
    });

    if ("error" in reviewed) {
      return res.status(reviewed.statusCode).json({
        ok: false,
        error: reviewed.error,
      });
    }

    res.json({
      ok: true,
      result: reviewed.result,
    });
  } catch (error: any) {
    console.error("Reject PR proposal error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/pr-proposals/:proposalId/prepare-execution", async (req, res) => {
  try {
    const proposalId = req.params.proposalId;
    const prepared = await prepareExecutionForProposal(proposalId);

    if ("error" in prepared) {
      return res.status(prepared.statusCode).json({
        ok: false,
        error: prepared.error,
      });
    }

    res.json({
      ok: true,
      result: prepared.result,
    });
  } catch (error: any) {
    console.error("Prepare PR execution error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/incidents/:id/pr-actions", async (req, res) => {
  try {
    const incidentId = req.params.id;
    const actions = await listPrActionsByIncident(incidentId);

    res.json({
      ok: true,
      actions,
    });
  } catch (error: any) {
    console.error("List PR actions error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/pr-proposals/:proposalId/generate-file-edits", async (req, res) => {
  try {
    const proposalId = req.params.proposalId;
    const generated = await generateFileEditsForProposal(proposalId);

    if ("error" in generated) {
      return res.status(generated.statusCode).json({
        ok: false,
        error: generated.error,
        action: generated.action || null,
      });
    }

    res.json({
      ok: true,
      result: generated.result,
    });
  } catch (error: any) {
    console.error("Generate file edits error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/pr-proposals/:proposalId/actions", async (req, res) => {
  try {
    const proposalId = req.params.proposalId;
    const actions = await listPrActionsByProposal(proposalId);

    res.json({
      ok: true,
      actions,
    });
  } catch (error: any) {
    console.error("List PR proposal actions error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/pr-proposals/:proposalId/validate-file-edits", async (req, res) => {
  try {
    const proposalId = req.params.proposalId;
    const validated = await validateFileEditsForProposal(proposalId);

    if ("error" in validated) {
      return res.status(validated.statusCode).json({
        ok: false,
        error: validated.error,
      });
    }

    res.json({
      ok: true,
      result: validated.result,
    });
  } catch (error: any) {
    console.error("Validate file edits error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/pr-proposals/:proposalId/regenerate-file-edits", async (req, res) => {
  try {
    const proposalId = req.params.proposalId;
    const regenerated = await regenerateFileEditsForProposal(proposalId);

    if ("error" in regenerated) {
      return res.status(regenerated.statusCode).json({
        ok: false,
        error: regenerated.error,
        action: regenerated.action || null,
      });
    }

    res.json({
      ok: true,
      result: regenerated.result,
    });
  } catch (error: any) {
    console.error("Regenerate file edits error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/pr-proposals/:proposalId/run-local-checks", async (req, res) => {
  try {
    const proposalId = req.params.proposalId;
    const result = await runLocalChecksForProposal(proposalId);

    if ("error" in result) {
      return res.status(result.statusCode).json({
        ok: false,
        error: result.error,
      });
    }

    res.json({
      ok: true,
      result: result.result,
    });
  } catch (error: any) {
    console.error("Run local checks error:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.listen(3020, () => {
  console.log("incident-detector running on http://localhost:3020");
});