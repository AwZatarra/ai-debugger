import {
  createBranchRef,
  createOrUpdateFile,
  createPullRequest,
  getBranchRef,
} from "./githubClient";
import { getLatestPrProposalById } from "./prProposalStore";
import {
  createPrAction,
  getLatestPrActionByProposalAndStatus,
} from "./prActionStore";

function buildPrTitle(proposal: any) {
  return proposal.title || `Fix incident ${proposal.incident_id}`;
}

function buildPrBody(input: {
  proposal: any;
  localChecksAction: any;
  editsAction: any;
}) {
  const proposal = input.proposal;
  const checks =
    input.localChecksAction?.payload?.checks || [];

  const buildCheck = checks.find((check: any) =>
    String(check?.name || "").includes("build")
  );

  return [
    `## Summary`,
    proposal.summary || "",
    ``,
    `## Incident`,
    `- Incident ID: ${proposal.incident_id}`,
    `- Proposal ID: ${proposal.proposal_id}`,
    ``,
    `## Review`,
    `- Reviewer: ${proposal.reviewer || proposal.proposal?.review?.reviewer || "unknown"}`,
    `- Reviewed at: ${proposal.reviewed_at || proposal.proposal?.review?.reviewed_at || "unknown"}`,
    `- Notes: ${proposal.review_notes || proposal.proposal?.review?.notes || ""}`,
    ``,
    `## Local checks`,
    `- Status: ${input.localChecksAction?.status || "unknown"}`,
    `- Real checks executed: ${input.localChecksAction?.payload?.has_real_checks ? "yes" : "no"}`,
    `- Executed checks count: ${input.localChecksAction?.payload?.executed_checks_count || 0}`,
    buildCheck
      ? `- Build: ${buildCheck.ok ? "passed" : "failed"}`
      : `- Build: not found`,
    `- Tests: not configured in service-b package.json`,
    ``,
    `## Files`,
    ...(input.editsAction?.payload?.file_edits || []).map(
      (edit: any) => `- \`${edit.path}\`: ${edit.change_summary || edit.purpose || ""}`
    ),
    ``,
    `## Guardrails`,
    `- Generated from approved proposal`,
    `- Restricted to allowlisted paths`,
    `- Created only after local checks passed`,
  ].join("\n");
}

export async function createGithubPrForProposal(proposalId: string) {
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
      error: "No prepared action found for this proposal",
    };
  }

  const validatedAction = await getLatestPrActionByProposalAndStatus(
    proposalId,
    "edits_validated"
  );

  if (!validatedAction) {
    return {
      statusCode: 409,
      error: "No edits_validated action found for this proposal",
    };
  }

  const localChecksAction = await getLatestPrActionByProposalAndStatus(
    proposalId,
    "local_checks_passed"
  );

  if (!localChecksAction) {
    return {
      statusCode: 409,
      error: "No local_checks_passed action found for this proposal",
    };
  }

  const sourceActionStatus = String(
    validatedAction?.payload?.source_action_status || ""
  );
  const sourceActionId = String(
    validatedAction?.payload?.source_action_id || ""
  );

  if (!sourceActionStatus || !sourceActionId) {
    return {
      statusCode: 409,
      error: "Validated action does not reference source edits action",
    };
  }

  const editsAction = await getLatestPrActionByProposalAndStatus(
    proposalId,
    sourceActionStatus
  );

  if (!editsAction || editsAction.action_id !== sourceActionId) {
    return {
      statusCode: 409,
      error: "Could not resolve source edits action from validated action",
    };
  }

  const fileEdits = Array.isArray(editsAction?.payload?.file_edits)
    ? editsAction.payload.file_edits
    : [];

  if (fileEdits.length === 0) {
    return {
      statusCode: 409,
      error: "No file edits found to create GitHub PR",
    };
  }

  const repository = proposal.repository;
  const baseBranch = proposal.target_branch || "main";
  const headBranch =
    preparedAction?.payload?.execution_plan?.suggested_branch_name ||
    preparedAction.branch_name;

  if (!repository || !headBranch) {
    return {
      statusCode: 409,
      error: "Repository or head branch is missing",
    };
  }

  try {
    const baseRef = await getBranchRef(repository, baseBranch);
    await createBranchRef(repository, headBranch, baseRef.object.sha);
  } catch (error: any) {
    if (!String(error?.message || "").includes("Reference already exists")) {
      const failedAction = await createPrAction({
        incident_id: proposal.incident_id,
        repository,
        branch_name: headBranch,
        status: "pr_failed",
        payload: {
          proposal_id: proposal.proposal_id,
          stage: "create_branch",
          error: error?.message || String(error),
        },
      });

      return {
        statusCode: 500,
        error: `Failed to create branch: ${error?.message || error}`,
        action: failedAction,
      };
    }
  }

  const fileResults: any[] = [];

  try {
    for (const edit of fileEdits) {
      const commitMessage = `Apply AI Debugger fix for ${edit.path}`;

      const result = await createOrUpdateFile(
        repository,
        headBranch,
        edit.path,
        edit.proposed_content,
        commitMessage
      );

      fileResults.push({
        path: edit.path,
        content_sha: result.content.sha,
        commit_sha: result.commit.sha,
        commit_url: result.commit.html_url,
      });
    }

    const prTitle = buildPrTitle(proposal);
    const prBody = buildPrBody({
      proposal,
      localChecksAction,
      editsAction,
    });

    const pr = await createPullRequest(repository, {
      title: prTitle,
      body: prBody,
      head: headBranch,
      base: baseBranch,
    });

    const action = await createPrAction({
      incident_id: proposal.incident_id,
      repository,
      branch_name: headBranch,
      pr_url: pr.html_url,
      status: "pr_created",
      payload: {
        proposal_id: proposal.proposal_id,
        source_validated_action_id: validatedAction.action_id,
        source_local_checks_action_id: localChecksAction.action_id,
        files: fileResults,
        pull_request: {
          id: pr.id,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          html_url: pr.html_url,
          base: baseBranch,
          head: headBranch,
        },
      },
    });

    return {
      statusCode: 200,
      result: {
        proposal_id: proposal.proposal_id,
        repository,
        base_branch: baseBranch,
        head_branch: headBranch,
        files: fileResults,
        pull_request: {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          html_url: pr.html_url,
        },
        action,
      },
    };
  } catch (error: any) {
    const failedAction = await createPrAction({
      incident_id: proposal.incident_id,
      repository,
      branch_name: headBranch,
      status: "pr_failed",
      payload: {
        proposal_id: proposal.proposal_id,
        stage: "file_update_or_pr_create",
        error: error?.message || String(error),
        partial_files: fileResults,
      },
    });

    return {
      statusCode: 500,
      error: `Failed to create GitHub PR: ${error?.message || error}`,
      action: failedAction,
    };
  }
}