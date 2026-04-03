import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { getLatestPrProposalById } from "./prProposalStore";
import {
  createPrAction,
  getLatestPrActionByProposalAndStatus,
} from "./prActionStore";

const execAsync = promisify(exec);

type CheckResult = {
  name: string;
  command: string;
  cwd: string;
  ok: boolean;
  skipped?: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
};

function skippedCheck(name: string, cwd: string, reason: string): CheckResult {
  return {
    name,
    command: "",
    cwd,
    ok: true,
    skipped: true,
    exit_code: 0,
    stdout: "",
    stderr: reason,
  };
}

function resolveRepoRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

function ensureDirForFile(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyDirectoryRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === ".tmp"
      ) {
        continue;
      }

      copyDirectoryRecursive(srcPath, destPath);
      continue;
    }

    fs.copyFileSync(srcPath, destPath);
  }
}

function readValidatedPayload(action: any) {
  return {
    execution_plan: action?.payload?.execution_plan || null,
    validation: action?.payload?.validation || null,
    source_action_id: action?.payload?.source_action_id || null,
    source_action_status: action?.payload?.source_action_status || null,
  };
}

function readEditsActionPayload(action: any) {
  return {
    file_edits_summary: action?.payload?.file_edits_summary || "",
    file_edits: Array.isArray(action?.payload?.file_edits)
      ? action.payload.file_edits
      : [],
  };
}

function applyFileEdits(workspaceRoot: string, fileEdits: any[]) {
  const appliedFiles: string[] = [];

  for (const edit of fileEdits) {
    const relativePath = String(edit?.path || "").trim();
    const proposedContent = String(edit?.proposed_content || "");

    if (!relativePath) continue;

    const absolutePath = path.join(workspaceRoot, relativePath);
    ensureDirForFile(absolutePath);
    fs.writeFileSync(absolutePath, proposedContent, "utf-8");
    appliedFiles.push(relativePath);
  }

  return appliedFiles;
}

async function runCommand(
  command: string,
  cwd: string
): Promise<CheckResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
    });

    return {
      name: command,
      command,
      cwd,
      ok: true,
      exit_code: 0,
      stdout: stdout || "",
      stderr: stderr || "",
    };
  } catch (error: any) {
    return {
      name: command,
      command,
      cwd,
      ok: false,
      exit_code: typeof error?.code === "number" ? error.code : 1,
      stdout: error?.stdout || "",
      stderr: error?.stderr || error?.message || "",
    };
  }
}

function trimOutput(value: string, maxLength = 4000) {
  if (!value) return "";
  return value.length > maxLength ? value.slice(0, maxLength) + "\n...[truncated]" : value;
}

export async function runLocalChecksForProposal(proposalId: string) {
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

  const validated = readValidatedPayload(validatedAction);

  if (!validated.validation?.valid) {
    return {
      statusCode: 409,
      error: "Latest edits_validated action is not valid",
    };
  }

  const sourceActionStatus = String(validated.source_action_status || "");
  const sourceActionId = String(validated.source_action_id || "");

  if (!sourceActionStatus || !sourceActionId) {
    return {
      statusCode: 409,
      error: "Validated action does not reference its source edits action",
    };
  }

  const sourceEditsAction = await getLatestPrActionByProposalAndStatus(
    proposalId,
    sourceActionStatus
  );

  if (!sourceEditsAction || sourceEditsAction.action_id !== sourceActionId) {
    return {
      statusCode: 409,
      error: "Could not resolve source edits action for validated edits",
    };
  }

  const editsPayload = readEditsActionPayload(sourceEditsAction);
  const fileEdits = editsPayload.file_edits || [];

  if (fileEdits.length === 0) {
    return {
      statusCode: 409,
      error: "No file edits found to run local checks against",
    };
  }

    const repoRoot = resolveRepoRoot();
    const tempRoot = path.join(repoRoot, ".tmp");
    fs.mkdirSync(tempRoot, { recursive: true });

    const shortId = proposalId.slice(0, 8);
    const workspaceRoot = path.join(
    tempRoot,
    `prchk-${shortId}-${crypto.randomUUID().slice(0, 8)}`
    );

    copyDirectoryRecursive(repoRoot, workspaceRoot);

    const appliedFiles = applyFileEdits(workspaceRoot, fileEdits);

    const serviceBRoot = path.join(workspaceRoot, "services", "service-b");
    const { scripts } = getAvailableScripts(serviceBRoot);

    const checks: CheckResult[] = [];
    const hasTestFile = appliedFiles.some((file) =>
    file.endsWith("__tests__/inventory-timeout.test.ts")
    );

    // Build / typecheck
    if (scripts.build) {
    const buildCommand =
        process.platform === "win32"
        ? "cmd.exe /c npm run build"
        : "npm run build";

    checks.push(await runCommand(buildCommand, serviceBRoot));
    } else if (scripts.typecheck) {
    const typecheckCommand =
        process.platform === "win32"
        ? "cmd.exe /c npm run typecheck"
        : "npm run typecheck";

    checks.push(await runCommand(typecheckCommand, serviceBRoot));
    } else {
    checks.push(
        skippedCheck(
        "build/typecheck",
        serviceBRoot,
        'Skipped: no "build" or "typecheck" script found in package.json'
        )
    );
    }

    // Tests
    if (scripts.test) {
    const testCommand =
        process.platform === "win32"
        ? hasTestFile
            ? "cmd.exe /c npm test -- src/__tests__/inventory-timeout.test.ts"
            : "cmd.exe /c npm test"
        : hasTestFile
        ? "npm test -- src/__tests__/inventory-timeout.test.ts"
        : "npm test";

    checks.push(await runCommand(testCommand, serviceBRoot));
    } else {
    checks.push(
        skippedCheck(
        "test",
        serviceBRoot,
        'Skipped: no "test" script found in package.json'
        )
    );
    }

  const executedChecks = checks.filter((check) => !check.skipped);
    const allExecutedPassed = executedChecks.every((check) => check.ok);
    const hasRealChecks = executedChecks.length > 0;

    const passed = hasRealChecks && allExecutedPassed;

    const finalStatus = hasRealChecks
    ? (allExecutedPassed ? "local_checks_passed" : "local_checks_failed")
    : "local_checks_inconclusive";

    const summarizedChecks = checks.map((check) => ({
    name: check.name,
    command: check.command,
    cwd: check.cwd,
    ok: check.ok,
    skipped: check.skipped || false,
    exit_code: check.exit_code,
    stdout: trimOutput(check.stdout),
    stderr: trimOutput(check.stderr),
    }));

    const action = await createPrAction({
    incident_id: proposal.incident_id,
    repository: proposal.repository,
    branch_name: validated.execution_plan?.suggested_branch_name || "",
    status: finalStatus,
    payload: {
        proposal_id: proposal.proposal_id,
        source_action_id: validatedAction.action_id,
        source_action_status: validatedAction.status,
        workspace_path: workspaceRoot,
        applied_files: appliedFiles,
        has_real_checks: hasRealChecks,
        executed_checks_count: executedChecks.length,
        checks: summarizedChecks,
    },
    });

    return {
    statusCode: 200,
    result: {
        proposal_id: proposal.proposal_id,
        passed,
        has_real_checks: hasRealChecks,
        executed_checks_count: executedChecks.length,
        workspace_path: workspaceRoot,
        applied_files: appliedFiles,
        checks: summarizedChecks,
        action,
    },
    };
}

function readPackageJson(packageJsonPath: string) {
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getAvailableScripts(serviceRoot: string) {
  const packageJsonPath = path.join(serviceRoot, "package.json");
  const packageJson = readPackageJson(packageJsonPath);

  return {
    packageJson,
    scripts:
      packageJson && typeof packageJson === "object" && packageJson.scripts
        ? packageJson.scripts
        : {},
  };
}