type GitHubRequestOptions = {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
};

const GITHUB_API_BASE_URL =
  process.env.GITHUB_API_BASE_URL || "https://api.github.com";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

function getDefaultHeaders(extra?: Record<string, string>) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    ...(extra || {}),
  };
}

async function githubRequest<T = any>(
  path: string,
  options: GitHubRequestOptions = {}
): Promise<T> {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: getDefaultHeaders(options.headers),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API ${options.method || "GET"} ${path} failed: ${response.status} ${text}`
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function parseRepoFullName(fullName: string) {
  const [owner, repo] = String(fullName || "").split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${fullName}`);
  }
  return { owner, repo };
}

export async function getBranchRef(
  repositoryFullName: string,
  branchName: string
) {
  const { owner, repo } = parseRepoFullName(repositoryFullName);
  return githubRequest<{
    ref: string;
    node_id: string;
    url: string;
    object: { type: string; sha: string; url: string };
  }>(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branchName)}`);
}

export async function createBranchRef(
  repositoryFullName: string,
  branchName: string,
  sha: string
) {
  const { owner, repo } = parseRepoFullName(repositoryFullName);
  return githubRequest<{
    ref: string;
    node_id: string;
    url: string;
    object: { type: string; sha: string; url: string };
  }>(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: {
      ref: `refs/heads/${branchName}`,
      sha,
    },
  });
}

export async function getFileContent(
  repositoryFullName: string,
  filePath: string,
  branchName: string
) {
  const { owner, repo } = parseRepoFullName(repositoryFullName);
  return githubRequest<{
    type: string;
    encoding?: string;
    size?: number;
    name: string;
    path: string;
    content?: string;
    sha: string;
  }>(
    `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(
      branchName
    )}`
  );
}

export async function createOrUpdateFile(
  repositoryFullName: string,
  branchName: string,
  filePath: string,
  contentUtf8: string,
  commitMessage: string
) {
  const { owner, repo } = parseRepoFullName(repositoryFullName);

  let existingSha: string | undefined;

  try {
    const existing = await getFileContent(repositoryFullName, filePath, branchName);
    existingSha = existing.sha;
  } catch {
    existingSha = undefined;
  }

  const encodedContent = Buffer.from(contentUtf8, "utf-8").toString("base64");

  const committerName =
    process.env.GITHUB_COMMITTER_NAME || "AI Debugger Bot";
  const committerEmail =
    process.env.GITHUB_COMMITTER_EMAIL || "bot@ai-debugger.local";

  return githubRequest<{
    content: { name: string; path: string; sha: string };
    commit: { sha: string; html_url: string };
  }>(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    body: {
      message: commitMessage,
      content: encodedContent,
      branch: branchName,
      sha: existingSha,
      committer: {
        name: committerName,
        email: committerEmail,
      },
    },
  });
}

export async function createPullRequest(
  repositoryFullName: string,
  input: {
    title: string;
    body: string;
    head: string;
    base: string;
  }
) {
  const { owner, repo } = parseRepoFullName(repositoryFullName);
  return githubRequest<{
    id: number;
    number: number;
    html_url: string;
    state: string;
    title: string;
  }>(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: input,
  });
}