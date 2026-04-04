import { getLatestPrProposalById } from "./prProposalStore";
import { createPrAction } from "./prActionStore";

type ExecutionValidation = {
  ready: boolean;
  reasons: string[];
};

function slugify(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function looksLikeConcreteFilePath(path: string) {
  const value = String(path || "").trim();
  if (!value) return false;
  if (value.endsWith("/")) return false;

  const lastSegment = value.split("/").pop() || "";
  return lastSegment.includes(".");
}

function isPathAllowlisted(path: string, allowlist: string[]) {
  return allowlist.some((prefix) => path.startsWith(prefix));
}

function validateProposalForExecution(proposal: any): ExecutionValidation {
  const reasons: string[] = [];

  if (!proposal) {
    return {
      ready: false,
      reasons: ["proposal not found"],
    };
  }

  if (proposal.status !== "approved") {
    reasons.push(`proposal status must be approved, got ${proposal.status}`);
  }

  if (!proposal.repository) {
    reasons.push("repository is required");
  }

  if (!proposal.target_branch) {
    reasons.push("target_branch is required");
  }

  const allowlistedPaths = Array.isArray(proposal.allowlisted_paths)
    ? proposal.allowlisted_paths
    : [];

  if (allowlistedPaths.length === 0) {
    reasons.push("allowlisted_paths cannot be empty");
  }

  const changedFiles = Array.isArray(proposal.changed_files)
    ? proposal.changed_files
    : [];

  if (changedFiles.length === 0) {
    reasons.push("changed_files cannot be empty");
  }

  changedFiles.forEach((file: any, index: number) => {
    const path = String(file?.path || "").trim();

    if (!path) {
      reasons.push(`changed_files[${index}].path is required`);
      return;
    }

    if (!looksLikeConcreteFilePath(path)) {
      reasons.push(
        `changed_files[${index}].path must be a concrete file path, got "${path}"`
      );
    }

    if (!isPathAllowlisted(path, allowlistedPaths)) {
      reasons.push(
        `changed_files[${index}].path is outside allowlist: "${path}"`
      );
    }

    if (!file?.purpose) {
      reasons.push(`changed_files[${index}].purpose is required`);
    }

    if (!file?.patch_summary) {
      reasons.push(`changed_files[${index}].patch_summary is required`);
    }
  });

  return {
    ready: reasons.length === 0,
    reasons,
  };
}

function buildSuggestedBranchName(proposal: any) {
  const incidentId = String(proposal.incident_id || "").slice(0, 8);
  const titlePart = slugify(proposal.title || "proposal");
  return `ai-debugger/${incidentId}-${titlePart}`.slice(0, 120);
}

export async function prepareExecutionForProposal(proposalId: string) {
  const proposal = await getLatestPrProposalById(proposalId);

  if (!proposal) {
    return {
      statusCode: 404,
      error: "PR proposal not found",
    };
  }

  const validation = validateProposalForExecution(proposal);
  const suggestedBranchName = buildSuggestedBranchName(proposal);

  const executionPlan = {
    proposal_id: proposal.proposal_id,
    incident_id: proposal.incident_id,
    repository: proposal.repository,
    target_branch: proposal.target_branch,
    suggested_branch_name: suggestedBranchName,
    files: (proposal.changed_files || []).map((file: any) => ({
      path: file.path,
      change_type: file.change_type || "modify",
      purpose: file.purpose || "",
      patch_summary: file.patch_summary || "",
      executable: looksLikeConcreteFilePath(file.path || "") &&
        isPathAllowlisted(file.path || "", proposal.allowlisted_paths || []),
    })),
    checks: proposal.checks || [],
    review: {
      status: proposal.status,
      reviewer: proposal.reviewer || proposal.proposal?.review?.reviewer || "",
      reviewed_at: proposal.reviewed_at || proposal.proposal?.review?.reviewed_at || null,
      review_notes: proposal.review_notes || proposal.proposal?.review?.notes || "",
    },
    guardrails: {
      github_pr_creation_allowed: false,
      requires_human_approval: true,
      allowlisted_paths: proposal.allowlisted_paths || [],
      require_concrete_file_paths: true,
    },
  };

  const action = await createPrAction({
    incident_id: proposal.incident_id,
    repository: proposal.repository || "",
    branch_name: suggestedBranchName,
    status: validation.ready ? "prepared" : "prepare_failed",
    payload: {
      proposal_id: proposal.proposal_id,
      validation,
      execution_plan: executionPlan,
    },
  });

  return {
    statusCode: 200,
    result: {
      proposal_id: proposal.proposal_id,
      ready: validation.ready,
      reasons: validation.reasons,
      execution_plan: executionPlan,
      action,
    },
  };
}