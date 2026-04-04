import crypto from "crypto";
import { buildIncidentContext } from "./contextBuilder";
import { getCauseRankingForIncident } from "./causeRanker";
import { getLlmCauseRankingForIncident } from "./llmCauseRanker";
import { openai, OPENAI_MODEL } from "./openaiClient";
import { savePrProposal } from "./prProposalStore";

type ProposalChangedFile = {
  path: string;
  change_type: "modify" | "create";
  purpose: string;
  patch_summary: string;
};

type ProposalCheck = {
  name: string;
  type: "test" | "lint" | "build" | "manual";
  command_or_step: string;
};

type ProposalResponse = {
  title: string;
  summary: string;
  risk_level: "low" | "medium" | "high";
  repository: string;
  target_branch: string;
  why: string;
  implementation_plan: string[];
  changed_files: ProposalChangedFile[];
  tests: string[];
  checks: ProposalCheck[];
};

const DEFAULT_REPOSITORY =
  process.env.PR_PROPOSAL_DEFAULT_REPOSITORY || "AwZatarra/ai-debugger";

const DEFAULT_TARGET_BRANCH =
  process.env.PR_PROPOSAL_DEFAULT_TARGET_BRANCH || "main";

const DEFAULT_ALLOWLIST = (
  process.env.PR_PROPOSAL_ALLOWLIST ||
  [
    "services/service-a/src/",
    "services/service-b/src/",
    "incident-detector/src/",
    "frontend/src/",
  ].join(",")
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function isPathAllowed(path: string, allowlist: string[]) {
  return allowlist.some((prefix) => path.startsWith(prefix));
}

function looksLikeConcreteFilePath(path: string) {
  const value = String(path || "").trim();
  if (!value) return false;
  if (value.endsWith("/")) return false;

  const lastSegment = value.split("/").pop() || "";
  return lastSegment.includes(".");
}

function filterConcreteAllowlistedFiles(
  files: ProposalChangedFile[],
  allowlist: string[]
) {
  const seen = new Set<string>();

  return files.filter((file) => {
    const path = String(file?.path || "").trim();

    if (!looksLikeConcreteFilePath(path)) {
      return false;
    }

    if (!isPathAllowed(path, allowlist)) {
      return false;
    }

    if (seen.has(path)) {
      return false;
    }

    seen.add(path);
    return true;
  });
}

function buildTopCauseInput(llmRanking: any, deterministicRanking: any) {
  const llmTop = llmRanking?.ranked_causes?.[0];
  const deterministicTop = deterministicRanking?.ranked_causes?.[0];

  return {
    llm_top_cause: llmTop
      ? {
          cause: llmTop.cause,
          confidence: llmTop.confidence,
          classification: llmTop.classification,
          why: llmTop.why,
          evidence_points: llmTop.evidence_points,
        }
      : null,
    deterministic_top_cause: deterministicTop
      ? {
          cause: deterministicTop.cause,
          score: deterministicTop.score,
          reasoning: deterministicTop.reasoning,
          supporting_evidence: deterministicTop.supporting_evidence,
        }
      : null,
  };
}

export async function generatePrProposalForIncident(input: {
  incidentId: string;
  repository?: string;
  target_branch?: string;
  allowlisted_paths?: string[];
}) {
  const repository = input.repository || DEFAULT_REPOSITORY;
  const targetBranch = input.target_branch || DEFAULT_TARGET_BRANCH;
  const allowlistedPaths =
    input.allowlisted_paths && input.allowlisted_paths.length > 0
      ? input.allowlisted_paths
      : DEFAULT_ALLOWLIST;

  const [context, deterministicRanking, llmRanking] = await Promise.all([
    buildIncidentContext(input.incidentId),
    getCauseRankingForIncident(input.incidentId),
    getLlmCauseRankingForIncident(input.incidentId),
  ]);

  if (!context) {
    return null;
  }

  const incident = context.incident;

  const generationInput = {
    incident: {
      incident_id: incident.incident_id,
      title: incident.title,
      primary_service: incident.primary_service,
      severity: incident.severity,
      fingerprint: incident.fingerprint,
      trace_id: incident.trace_id,
      error_type: incident.error_type,
      error_message: incident.error_message,
    },
    evidence: context.evidence || {},
    top_causes: buildTopCauseInput(llmRanking, deterministicRanking),
    allowlisted_paths: allowlistedPaths,
    repository,
    target_branch: targetBranch,
    proposal_output_rules: {
      require_concrete_file_paths: true,
      forbid_directory_paths: true,
      max_files: 3,
      prefer_primary_service_files: true,
      avoid_detector_changes_unless_strongly_justified: true,
      examples_of_good_paths: [
        "services/service-b/src/index.ts",
        "services/service-b/src/dbClient.ts",
        "services/service-b/src/__tests__/inventory-timeout.test.ts",
      ],
      examples_of_bad_paths: [
        "services/service-b/src/",
        "incident-detector/src/",
      ],
    },
    hard_guardrails: {
      do_not_create_github_pr: true,
      do_not_generate_raw_diff: true,
      do_not_edit_non_allowlisted_paths: true,
      propose_only_small_targeted_changes: true,
      require_human_approval: true,
    },
  };

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions:
      "You are a senior software engineer preparing a structured PR proposal after an incident. " +
      "Use only the supplied incident context and candidate causes. " +
      "Do not invent repository files outside the allowlisted paths. " +
      "Do not propose broad refactors, infrastructure migrations, or arbitrary edits. " +
      "Keep the proposal reviewable, small, and concrete. " +
      "Return only a structured proposal for human approval. " +
      "Do not create a real PR. Do not output unified diffs. " +
      "Every changed_files.path must be a concrete file path, never a directory. " +
      "Do not return folder-only paths such as services/service-b/src/ or incident-detector/src/. " +
      "Prefer a very small set of specific files that are most likely to contain the fix, ideally 1 to 3 files maximum. " +
      "Prefer files under the primary service allowlisted path. " +
      "Only include incident-detector files if there is strong evidence they truly need to change. " +
      "If uncertain, choose the most likely concrete existing file rather than a folder.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Generate a structured PR proposal for this incident.\n\n" +
              JSON.stringify(generationInput, null, 2),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pr_proposal",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            risk_level: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            repository: { type: "string" },
            target_branch: { type: "string" },
            why: { type: "string" },
            implementation_plan: {
              type: "array",
              items: { type: "string" },
            },
            changed_files: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  path: { type: "string" },
                  change_type: {
                    type: "string",
                    enum: ["modify", "create"],
                  },
                  purpose: { type: "string" },
                  patch_summary: { type: "string" },
                },
                required: ["path", "change_type", "purpose", "patch_summary"],
              },
            },
            tests: {
              type: "array",
              items: { type: "string" },
            },
            checks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["test", "lint", "build", "manual"],
                  },
                  command_or_step: { type: "string" },
                },
                required: ["name", "type", "command_or_step"],
              },
            },
          },
          required: [
            "title",
            "summary",
            "risk_level",
            "repository",
            "target_branch",
            "why",
            "implementation_plan",
            "changed_files",
            "tests",
            "checks",
          ],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as ProposalResponse;

  const filteredChangedFiles = filterConcreteAllowlistedFiles(
    parsed.changed_files || [],
    allowlistedPaths
  );

  if (filteredChangedFiles.length === 0) {
    throw new Error(
      "Generated PR proposal did not contain any concrete allowlisted file paths"
    );
  }

  const proposalId = crypto.randomUUID();

  const proposal = {
    proposal_id: proposalId,
    incident_id: incident.incident_id,
    status: "pending_review",
    llm_model: OPENAI_MODEL,
    repository,
    target_branch: targetBranch,
    title: parsed.title,
    summary: parsed.summary,
    risk_level: parsed.risk_level,
    allowlisted_paths: allowlistedPaths,
    changed_files: filteredChangedFiles,
    checks: parsed.checks || [],
    proposal: {
      ...parsed,
      repository,
      target_branch: targetBranch,
      changed_files: filteredChangedFiles,
      guardrails: {
        github_pr_creation_allowed: false,
        requires_human_approval: true,
        allowlisted_paths: allowlistedPaths,
      },
      source_context: {
        incident_id: incident.incident_id,
        incident_title: incident.title,
        primary_service: incident.primary_service,
      },
    },
  };

  const saved = await savePrProposal(proposal);

  return {
    incident: {
      incident_id: incident.incident_id,
      title: incident.title,
      primary_service: incident.primary_service,
      fingerprint: incident.fingerprint,
      trace_id: incident.trace_id,
      error_type: incident.error_type,
    },
    proposal: saved,
    inputs: {
      has_deterministic_ranking: !!deterministicRanking,
      has_llm_ranking: !!llmRanking,
      allowlisted_paths_count: allowlistedPaths.length,
      proposed_files_before_filter: parsed.changed_files?.length || 0,
      proposed_files_after_filter: filteredChangedFiles.length,
    },
  };
}