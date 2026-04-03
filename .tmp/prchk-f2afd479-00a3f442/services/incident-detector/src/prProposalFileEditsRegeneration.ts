import fs from "fs";
import path from "path";
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

function resolveRepoRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

function isTestLikePath(filePath: string) {
  const normalized = String(filePath || "").toLowerCase();
  return (
    normalized.includes("/__tests__/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.tsx")
  );
}

function detectLanguageFromPath(filePath: string) {
  if (filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".tsx")) return "typescript";
  if (filePath.endsWith(".js")) return "javascript";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".sql")) return "sql";
  if (filePath.endsWith(".md")) return "markdown";
  return "text";
}

function isNonEmptyString(value: any) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPathAllowlisted(filePath: string, allowlist: string[]) {
  return allowlist.some((prefix) => filePath.startsWith(prefix));
}

function walkFilesRecursive(absoluteDir: string, repoRoot: string): string[] {
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const absoluteEntry = path.join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkFilesRecursive(absoluteEntry, repoRoot));
      continue;
    }

    const relativePath = path
      .relative(repoRoot, absoluteEntry)
      .replace(/\\/g, "/");

    results.push(relativePath);
  }

  return results;
}

function listExistingFilesInAllowlist(repoRoot: string, allowlist: string[]) {
  const allFiles = new Set<string>();

  for (const prefix of allowlist) {
    const absolutePrefix = path.join(repoRoot, prefix);
    const files = walkFilesRecursive(absolutePrefix, repoRoot);
    for (const file of files) {
      allFiles.add(file);
    }
  }

  return Array.from(allFiles).sort();
}

function readExistingFileContexts(
  repoRoot: string,
  filePaths: string[]
) {
  const contexts: Array<{ path: string; content: string }> = [];

  for (const filePath of filePaths) {
    const absolutePath = path.join(repoRoot, filePath);

    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(absolutePath, "utf-8");
      contexts.push({
        path: filePath,
        content,
      });
    } catch {
      // ignore unreadable files
    }
  }

  return contexts;
}

function sanitizeRegeneratedEdits(
  rawEdits: any[],
  existingFiles: string[],
  allowlistedPaths: string[],
  preparedFiles: any[]
) {
  const preparedByPath = new Map<string, any>(
    preparedFiles.map((file: any) => [file.path, file])
  );

  const existingSet = new Set(existingFiles);
  const seen = new Set<string>();
  const sanitized: FileEdit[] = [];

  for (const item of rawEdits || []) {
    const filePath = String(item?.path || "").trim();
    const editType =
      item?.edit_type === "create" ? "create" : "modify";

    if (!filePath || seen.has(filePath)) {
      continue;
    }

    if (!isPathAllowlisted(filePath, allowlistedPaths)) {
      continue;
    }

    if (isTestLikePath(filePath)) {
      continue;
    }

    if (editType !== "modify") {
      continue;
    }

    if (!existingSet.has(filePath)) {
      continue;
    }

    if (!isNonEmptyString(item?.proposed_content)) {
      continue;
    }

    const prepared = preparedByPath.get(filePath);

    sanitized.push({
      path: filePath,
      edit_type: editType,
      language: detectLanguageFromPath(filePath),
      purpose: String(item?.purpose || prepared?.purpose || "").trim(),
      change_summary: String(
        item?.change_summary || prepared?.patch_summary || ""
      ).trim(),
      proposed_content: String(item.proposed_content),
      notes: Array.isArray(item?.notes)
        ? item.notes.map((n: any) => String(n)).filter(Boolean)
        : [],
    });

    seen.add(filePath);
  }

  return sanitized;
}

export async function regenerateFileEditsForProposal(proposalId: string) {
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

  const failedValidationAction = await getLatestPrActionByProposalAndStatus(
    proposalId,
    "edits_validation_failed"
  );

  if (!failedValidationAction) {
    return {
      statusCode: 409,
      error: "No edits_validation_failed action found for this proposal",
    };
  }

  const executionPlan = preparedAction.payload?.execution_plan;
  const preparedFiles = Array.isArray(executionPlan?.files)
    ? executionPlan.files
    : [];

  if (preparedFiles.length === 0) {
    return {
      statusCode: 409,
      error: "Prepared execution plan does not contain files",
    };
  }

  const validation = failedValidationAction.payload?.validation || {};
  const validationReasons = Array.isArray(validation?.reasons)
    ? validation.reasons
    : [];

  const repoRoot = resolveRepoRoot();
  const allowlistedPaths = Array.isArray(
    executionPlan?.guardrails?.allowlisted_paths
  )
    ? executionPlan.guardrails.allowlisted_paths
    : Array.isArray(proposal.allowlisted_paths)
    ? proposal.allowlisted_paths
    : [];

  const existingFiles = listExistingFilesInAllowlist(repoRoot, allowlistedPaths);

  if (existingFiles.length === 0) {
    return {
      statusCode: 500,
      error: "No existing files found under allowlisted paths",
    };
  }

  const preparedExistingRuntimeFiles = preparedFiles
    .map((file: any) => String(file?.path || "").trim())
    .filter((filePath: string) => {
      return (
        filePath &&
        existingFiles.includes(filePath) &&
        !isTestLikePath(filePath)
      );
    });

  const currentFileContext = readExistingFileContexts(
    repoRoot,
    preparedExistingRuntimeFiles
  );

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
    previous_validation_failure: {
      reasons: validationReasons,
      file_validations: validation?.file_validations || [],
    },
    repo_constraints: {
      repo_root: repoRoot,
      allowlisted_paths: allowlistedPaths,
      existing_files_under_allowlist: existingFiles,
      rules: {
        modify_only_existing_files: true,
        do_not_generate_test_files: true,
        do_not_introduce_new_testing_frameworks: true,
        do_not_reuse_invalid_paths: true,
        prefer_minimal_changes: true,
        prefer_primary_service_files: true,
        keep_changes_in_existing_runtime_files_only: true,
      },
    },
    current_file_context: currentFileContext,
  };

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions:
      "You are a senior software engineer regenerating file edits after a validation failure. " +
      "Use the previous failure reasons, the real repo file list, and the current file contents as hard constraints. " +
      "Never return edit_type=modify for a file that is not present in existing_files_under_allowlist. " +
      "Do not repeat previously invalid paths. " +
      "Do not generate test files. " +
      "Do not introduce Jest, Vitest, Supertest, Mocha, or any new testing framework. " +
      "Restrict the solution to existing runtime files only. " +
      "Preserve the existing file structure, imports, and behavior whenever possible. " +
      "Do not replace the current service implementation with a different architecture. " +
      "Do not introduce demo data, hardcoded inventory payloads, or a new standalone service design. " +
      "Keep existing logging, telemetry, dotenv loading, and log persistence behavior unless a change is strictly required for the timeout fix. " +
      "Produce a conservative patch over the current file content, not a rewrite from scratch. " +
      "Prefer a single-file fix when possible. " +
      "Return complete file content in proposed_content. " +
      "Only output JSON matching the schema.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Regenerate concrete file edits for this proposal using the real repo constraints.\n\n" +
              JSON.stringify(llmInput, null, 2),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pr_file_edits_regenerated",
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

  const edits = sanitizeRegeneratedEdits(
    parsed.edits || [],
    existingFiles,
    allowlistedPaths,
    preparedFiles
  ).slice(0, 1);

  if (edits.length === 0) {
    const failedAction = await createPrAction({
      incident_id: proposal.incident_id,
      repository: proposal.repository,
      branch_name: executionPlan?.suggested_branch_name || "",
      status: "edits_regeneration_failed",
      payload: {
        proposal_id: proposal.proposal_id,
        previous_validation_action_id: failedValidationAction.action_id,
        execution_plan: executionPlan,
        previous_validation_failure: validation,
        reason: "No valid regenerated file edits were produced",
      },
    });

    return {
      statusCode: 500,
      error: "No valid regenerated file edits were produced",
      action: failedAction,
    };
  }

  const action = await createPrAction({
    incident_id: proposal.incident_id,
    repository: proposal.repository,
    branch_name: executionPlan?.suggested_branch_name || "",
    status: "edits_regenerated",
    payload: {
      proposal_id: proposal.proposal_id,
      previous_validation_action_id: failedValidationAction.action_id,
      execution_plan: executionPlan,
      file_edits_summary: parsed.summary,
      file_edits: edits,
      repo_constraints: {
        allowlisted_paths: allowlistedPaths,
        existing_files_under_allowlist_count: existingFiles.length,
      },
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