import { openai, OPENAI_MODEL } from "./openaiClient";
import { getLatestPrProposalById } from "./prProposalStore";
import {
  createPrAction,
  getLatestPrActionByProposalAndStatus,
} from "./prActionStore";

type FileEdit = {
  path: string;
  edit_type: "modify" | "create";
  language: string;
  purpose: string;
  change_summary: string;
  proposed_content: string;
  notes: string[];
};

type FileEditsResponse = {
  summary: string;
  edits: FileEdit[];
};

function detectLanguageFromPath(path: string) {
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".sql")) return "sql";
  if (path.endsWith(".md")) return "markdown";
  return "text";
}

function isNonEmptyString(value: any) {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeEdits(rawEdits: any[], preparedFiles: any[]) {
  const preparedByPath = new Map<string, any>(
    preparedFiles.map((file: any) => [file.path, file])
  );

  const sanitized: FileEdit[] = [];

  for (const item of rawEdits || []) {
    const path = String(item?.path || "").trim();
    const prepared = preparedByPath.get(path);

    if (!prepared) {
      continue;
    }

    if (!isNonEmptyString(item?.proposed_content)) {
      continue;
    }

    sanitized.push({
      path,
      edit_type: item?.edit_type === "create" ? "create" : "modify",
      language: detectLanguageFromPath(path),
      purpose: String(item?.purpose || prepared.purpose || "").trim(),
      change_summary: String(
        item?.change_summary || prepared.patch_summary || ""
      ).trim(),
      proposed_content: String(item.proposed_content),
      notes: Array.isArray(item?.notes)
        ? item.notes.map((n: any) => String(n)).filter(Boolean)
        : [],
    });
  }

  return sanitized;
}

export async function generateFileEditsForProposal(proposalId: string) {
  const proposal = await getLatestPrProposalById(proposalId);

  if (!proposal) {
    return {
      statusCode: 404,
      error: "PR proposal not found",
    };
  }

  if (proposal.status !== "approved") {
    return {
      statusCode: 409,
      error: `PR proposal must be approved, got ${proposal.status}`,
    };
  }

  const preparedAction = await getLatestPrActionByProposalAndStatus(
    proposalId,
    "prepared"
  );

  if (!preparedAction) {
    return {
      statusCode: 409,
      error: "No prepared execution plan found for this proposal",
    };
  }

  const executionPlan = preparedAction.payload?.execution_plan;
  const preparedFiles = executionPlan?.files || [];

  if (!Array.isArray(preparedFiles) || preparedFiles.length === 0) {
    return {
      statusCode: 409,
      error: "Prepared execution plan does not contain executable files",
    };
  }

  const llmInput = {
    proposal: {
      proposal_id: proposal.proposal_id,
      incident_id: proposal.incident_id,
      title: proposal.title,
      summary: proposal.summary,
      risk_level: proposal.risk_level,
      repository: proposal.repository,
      target_branch: proposal.target_branch,
    },
    execution_plan: executionPlan,
    file_edit_rules: {
      output_only_requested_files: true,
      preserve_scope: true,
      no_broad_refactors: true,
      no_placeholder_todo_content: true,
      each_edit_must_include_full_file_content: true,
      if_file_is_new_return_complete_new_file: true,
      if_file_is_modified_return_complete_rewritten_file: true,
    },
  };

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions:
      "You are a senior software engineer generating concrete file edits for a previously approved and prepared PR proposal. " +
      "Use only the files listed in the execution plan. " +
      "Do not add extra files. " +
      "Do not output explanations outside the JSON response. " +
      "For each file, return complete file content in proposed_content. " +
      "Keep the changes small, coherent, and directly aligned with the stated purpose and patch summary. " +
      "Prefer compilable, realistic TypeScript code. " +
      "For tests, return a focused test file aligned with the target behavior.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Generate concrete file edits for this prepared proposal.\n\n" +
              JSON.stringify(llmInput, null, 2),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pr_file_edits",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            edits: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  path: { type: "string" },
                  edit_type: {
                    type: "string",
                    enum: ["modify", "create"],
                  },
                  purpose: { type: "string" },
                  change_summary: { type: "string" },
                  proposed_content: { type: "string" },
                  notes: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: [
                  "path",
                  "edit_type",
                  "purpose",
                  "change_summary",
                  "proposed_content",
                  "notes",
                ],
              },
            },
          },
          required: ["summary", "edits"],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as FileEditsResponse;
  const edits = sanitizeEdits(parsed.edits || [], preparedFiles);

  if (edits.length === 0) {
    const failedAction = await createPrAction({
      incident_id: proposal.incident_id,
      repository: proposal.repository,
      branch_name: executionPlan?.suggested_branch_name || "",
      status: "edits_generation_failed",
      payload: {
        proposal_id: proposal.proposal_id,
        reason: "No valid file edits were generated",
        execution_plan: executionPlan,
      },
    });

    return {
      statusCode: 500,
      error: "No valid file edits were generated",
      action: failedAction,
    };
  }

  const action = await createPrAction({
    incident_id: proposal.incident_id,
    repository: proposal.repository,
    branch_name: executionPlan?.suggested_branch_name || "",
    status: "edits_generated",
    payload: {
      proposal_id: proposal.proposal_id,
      execution_plan: executionPlan,
      file_edits_summary: parsed.summary,
      file_edits: edits,
    },
  });

  return {
    statusCode: 200,
    result: {
      proposal_id: proposal.proposal_id,
      summary: parsed.summary,
      edits,
      action,
    },
  };
}