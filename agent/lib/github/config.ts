import { createAppAuth } from "@octokit/auth-app";

/** Canonical GitHub repository whose files may become governed Process sources. */
export const POWERFARM_PLANNING_REPOSITORY =
  process.env.POWERFARM_PLANNING_REPOSITORY ?? "powerfarm/planning";

const [owner, repo] = POWERFARM_PLANNING_REPOSITORY.split("/");

if (!(owner && repo)) {
  throw new Error(
    "POWERFARM_PLANNING_REPOSITORY must use the owner/repository form"
  );
}

/** Canonical planning repository owner used as extension context. */
export const POWERFARM_PLANNING_OWNER = owner;

/** Canonical planning repository name used as extension context. */
export const POWERFARM_PLANNING_REPO = repo;

const INSTALLATION_PERMISSIONS = {
  checks: "read",
  contents: "read",
  pull_requests: "read",
  statuses: "read",
} as const;

let appAuth: ReturnType<typeof createAppAuth> | undefined;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the PowerFarm GitHub App`);
  }
  return value;
}

/**
 * Returns a cached, short-lived token for the repository-scoped GitHub App installation.
 */
export async function githubInstallationToken(): Promise<string> {
  const installationId = requiredEnvironment("GITHUB_APP_INSTALLATION_ID");
  appAuth ??= createAppAuth({
    appId: requiredEnvironment("GITHUB_APP_ID"),
    privateKey: requiredEnvironment("GITHUB_APP_PRIVATE_KEY").replaceAll(
      "\\n",
      "\n"
    ),
  });
  const authentication = await appAuth({
    installationId,
    permissions: INSTALLATION_PERMISSIONS,
    repositoryNames: [POWERFARM_PLANNING_REPO],
    type: "installation",
  });
  return authentication.token;
}

/** Exact read-only GitHub tool surface exposed to the lead. */
export const GITHUB_READ_TOOLS = [
  "getRepository",
  "getRepositoryTree",
  "getFileContent",
  "listBranches",
  "listCommits",
  "getCommit",
  "compareCommits",
  "listPullRequests",
  "getPullRequest",
  "getPullRequestContext",
  "listPullRequestFiles",
  "listPullRequestReviews",
  "listCheckRuns",
  "getCombinedStatus",
] as const;
