import { getLatestPrProposalById, savePrProposal } from "./prProposalStore";

type ReviewDecision = "approved" | "rejected";

function nowForClickHouse() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

export async function reviewPrProposal(input: {
  proposalId: string;
  decision: ReviewDecision;
  reviewer: string;
  notes?: string;
}) {
  const existing = await getLatestPrProposalById(input.proposalId);

  if (!existing) {
    return {
      error: "PR proposal not found",
      statusCode: 404,
    };
  }

  if (existing.status !== "pending_review") {
    return {
      error: `PR proposal is already ${existing.status}`,
      statusCode: 409,
    };
  }

  const reviewedAt = nowForClickHouse();

  const updatedProposalPayload = {
    ...(existing.proposal || {}),
    review: {
      decision: input.decision,
      reviewer: input.reviewer,
      notes: input.notes || "",
      reviewed_at: reviewedAt,
    },
    guardrails: {
      ...(existing.proposal?.guardrails || {}),
      github_pr_creation_allowed: false,
      requires_human_approval: true,
    },
  };

  const saved = await savePrProposal({
    proposal_id: existing.proposal_id,
    incident_id: existing.incident_id,
    status: input.decision,
    llm_model: existing.llm_model,
    repository: existing.repository,
    target_branch: existing.target_branch,
    title: existing.title,
    summary: existing.summary,
    risk_level: existing.risk_level,
    allowlisted_paths: existing.allowlisted_paths || [],
    changed_files: existing.changed_files || [],
    checks: existing.checks || [],
    proposal: updatedProposalPayload,
    reviewed_at: reviewedAt,
    reviewer: input.reviewer,
    review_notes: input.notes || "",
  });

  return {
    result: saved,
    statusCode: 200,
  };
}