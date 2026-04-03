import fs from "fs";
import path from "path";
import { getLatestPrProposalById } from "./prProposalStore";
import {
  createPrAction,
  getLatestPrActionByProposalAndStatus,
} from "./prActionStore";

type FileValidation = {
  path: string;
  edit_type: "modify" | "create";
  exists_in_repo: boolean;
  allowlisted: boolean;
  has_content: boolean;
  operation_valid: boolean;
  valid: boolean;
  reasons: string[];
};

function resolveRepoRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

function isPathAllowlisted(filePath: string, allowlist: string[]) {
  return allowlist.some((prefix) => filePath.startsWith(prefix));
}

function readEditsGeneratedPayload(action: any) {
  return {
    execution_plan: action?.payload?.execution_plan || null,
    file_edits: Array.isArray(action?.payload?.file_edits)
      ? action.payload.file_edits
      : [],
    file_edits_summary: action?.payload?.file_edits_summary || "",
  };
}

function validateSingleFile(input: {
  repoRoot: string;
  file: any;
  allowlistedPaths: string[];
}) {
  const filePath = String(input.file?.path || "").trim();
  const editType =
    input.file?.edit_type === "create" ? "create" : "modify";
  const proposedContent = String(input.file?.proposed_content || "");
  const absolutePath = path.join(input.repoRoot, filePath);
  const existsInRepo = fs.existsSync(absolutePath);
  const allowlisted = isPathAllowlisted(filePath, input.allowlistedPaths);
  const hasContent = proposedContent.trim().length > 0;

  const reasons: string[] = [];

  if (!allowlisted) {
    reasons.push("path is outside allowlisted paths");
  }

  if (!hasContent) {
    reasons.push("proposed_content is empty");
  }

  if (editType === "modify" && !existsInRepo) {
    reasons.push("edit_type is modify but file does not exist in repo");
  }

  if (editType === "create" && existsInRepo) {
    reasons.push("edit_type is create but file already exists in repo");
  }

  const operationValid =
    (editType === "modify" && existsInRepo) ||
    (editType === "create" && !existsInRepo);

  return {
    path: filePath,
    edit_type: editType,
    exists_in_repo: existsInRepo,
    allowlisted,
    has_content: hasContent,
    operation_valid: operationValid,
    valid: reasons.length === 0,
    reasons,
  } satisfies FileValidation;
}

export async function validateFileEditsForProposal(proposalId: string) {
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

  const regeneratedEditsAction = await getLatestPrActionByProposalAndStatus(
    proposalId,
    "edits_regenerated"
    );

    const generatedEditsAction = await getLatestPrActionByProposalAndStatus(
    proposalId,
    "edits_generated"
    );

    const editsAction = regeneratedEditsAction || generatedEditsAction;

    if (!editsAction) {
    return {
        statusCode: 409,
        error: "No edits_generated or edits_regenerated action found for this proposal",
    };
    }

  const { execution_plan, file_edits, file_edits_summary } =
    readEditsGeneratedPayload(editsAction);

  if (!execution_plan) {
    return {
      statusCode: 409,
      error: "edits_generated action does not contain execution_plan",
    };
  }

  if (!Array.isArray(file_edits) || file_edits.length === 0) {
    return {
      statusCode: 409,
      error: "edits_generated action does not contain file_edits",
    };
  }

  const repoRoot = resolveRepoRoot();
  const allowlistedPaths = Array.isArray(
    execution_plan?.guardrails?.allowlisted_paths
  )
    ? execution_plan.guardrails.allowlisted_paths
    : Array.isArray(proposal.allowlisted_paths)
    ? proposal.allowlisted_paths
    : [];

  const fileValidations = file_edits.map((file: any) =>
    validateSingleFile({
      repoRoot,
      file,
      allowlistedPaths,
    })
  );

  const valid = fileValidations.every((item) => item.valid);
  const reasons = fileValidations.flatMap((item) =>
    item.reasons.map((reason) => `${item.path}: ${reason}`)
  );

  const checks = {
    repo_root: repoRoot,
    structural_validation: valid ? "passed" : "failed",
    typecheck: "not_run",
    tests: "not_run",
    lint: "not_run",
  };

  const action = await createPrAction({
    incident_id: proposal.incident_id,
    repository: proposal.repository,
    branch_name: execution_plan?.suggested_branch_name || "",
    status: valid ? "edits_validated" : "edits_validation_failed",
    payload: {
      proposal_id: proposal.proposal_id,
      source_action_id: editsAction.action_id,
      source_action_status: editsAction.status,
      file_edits_summary,
      execution_plan,
      validation: {
        valid,
        reasons,
        file_validations: fileValidations,
        checks,
      },
    },
  });

  return {
    statusCode: 200,
    result: {
      proposal_id: proposal.proposal_id,
      source_action_id: editsAction.action_id,
      source_action_status: editsAction.status,
      valid,
      reasons,
      file_validations: fileValidations,
      checks,
      action,
    },
  };
}