import { createHash } from "node:crypto";
import { z } from "zod";
import {
  githubInstallationToken,
  POWERFARM_PLANNING_REPOSITORY,
} from "#lib/github/config.js";
import { ProcessError } from "@/lib/processes/errors";
import {
  type GovernedArtifactSnapshot,
  governedArtifactSnapshotSchema,
} from "@/lib/processes/governed-artifacts";

const commitSchema = z.object({ sha: z.string() }).passthrough();
const contentSchema = z
  .object({
    content: z.string().optional(),
    encoding: z.string().optional(),
    html_url: z.url(),
    sha: z.string(),
    type: z.string(),
  })
  .passthrough();
const blobSchema = z
  .object({ content: z.string(), encoding: z.string() })
  .passthrough();
const pullRequestSchema = z
  .object({ html_url: z.url(), number: z.number().int(), state: z.string() })
  .passthrough();
const reviewSchema = z
  .object({
    state: z.string(),
    submitted_at: z.string().nullable().optional(),
    user: z
      .object({ id: z.number().int(), login: z.string() })
      .nullable()
      .optional(),
  })
  .passthrough();
const checkRunsSchema = z
  .object({
    check_runs: z.array(
      z
        .object({
          conclusion: z.string().nullable(),
          status: z.string(),
        })
        .passthrough()
    ),
    total_count: z.number().int().nonnegative(),
  })
  .passthrough();

const LEADING_SLASHES_PATTERN = /^\/+/;

export interface ObserveGitHubArtifactInput {
  readonly path: string;
  readonly repository: string;
  readonly requestedRef: string;
}

export interface GitHubArtifactObserver {
  readonly observe: (
    input: ObserveGitHubArtifactInput
  ) => Promise<GovernedArtifactSnapshot>;
}

interface GitHubArtifactObserverDependencies {
  readonly allowedRepositories?: readonly string[];
  readonly fetch?: typeof globalThis.fetch;
  readonly getToken?: () => Promise<string>;
}

function encodedRepository(repository: string): string {
  return repository
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function encodedPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeBase64(content: string): Uint8Array {
  return Buffer.from(content.replaceAll("\n", ""), "base64");
}

function checkState(checkRuns: z.infer<typeof checkRunsSchema>): {
  readonly state: GovernedArtifactSnapshot["checksState"];
  readonly successful: number;
} {
  if (checkRuns.total_count === 0) {
    return { state: "none", successful: 0 };
  }
  if (checkRuns.check_runs.some((run) => run.status !== "completed")) {
    return { state: "pending", successful: 0 };
  }
  const accepted = new Set(["success", "neutral", "skipped"]);
  const successful = checkRuns.check_runs.filter(
    (run) => run.conclusion && accepted.has(run.conclusion)
  ).length;
  return {
    state: successful === checkRuns.total_count ? "passing" : "failing",
    successful,
  };
}

function reviewCounts(reviews: readonly z.infer<typeof reviewSchema>[]): {
  readonly approved: number;
  readonly changesRequested: number;
} {
  const latestByReviewer = new Map<number, string>();
  const ordered = [...reviews].toSorted((left, right) =>
    (left.submitted_at ?? "").localeCompare(right.submitted_at ?? "")
  );
  for (const review of ordered) {
    if (review.user) {
      latestByReviewer.set(review.user.id, review.state.toUpperCase());
    }
  }
  const states = [...latestByReviewer.values()];
  return {
    approved: states.filter((state) => state === "APPROVED").length,
    changesRequested: states.filter((state) => state === "CHANGES_REQUESTED")
      .length,
  };
}

/**
 * Creates the bounded GitHub reader used by the institutional observation tool.
 */
export function createGitHubArtifactObserver(
  dependencies: GitHubArtifactObserverDependencies = {}
): GitHubArtifactObserver {
  const allowedRepositories = new Set(
    dependencies.allowedRepositories ?? [POWERFARM_PLANNING_REPOSITORY]
  );
  const request = dependencies.fetch ?? globalThis.fetch;
  const resolveToken = dependencies.getToken ?? githubInstallationToken;

  return {
    async observe(input) {
      const repository = input.repository.trim();
      const path = input.path.trim().replace(LEADING_SLASHES_PATTERN, "");
      const requestedRef = input.requestedRef.trim();
      if (!allowedRepositories.has(repository)) {
        throw new ProcessError(
          "artifact_not_allowed",
          "That GitHub repository is not authorized for Process observations."
        );
      }
      if (!(path && requestedRef)) {
        throw new ProcessError(
          "artifact_observation_failed",
          "A repository path and requested ref are required."
        );
      }

      const token = await resolveToken();
      const base = `https://api.github.com/repos/${encodedRepository(repository)}`;
      const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "powerfarm-process-artifact-observer",
        "X-GitHub-Api-Version": "2022-11-28",
      };

      async function readJson<T>(
        url: string,
        schema: z.ZodType<T>
      ): Promise<T> {
        const response = await request(url, { headers });
        if (!response.ok) {
          throw new ProcessError(
            "artifact_observation_failed",
            `GitHub could not resolve the governed artifact (${response.status}).`
          );
        }
        return schema.parse(await response.json());
      }

      const commit = await readJson(
        `${base}/commits/${encodeURIComponent(requestedRef)}`,
        commitSchema
      );
      const content = await readJson(
        `${base}/contents/${encodedPath(path)}?ref=${encodeURIComponent(commit.sha)}`,
        contentSchema
      );
      if (content.type !== "file") {
        throw new ProcessError(
          "artifact_observation_failed",
          "The governed artifact path must identify one GitHub file."
        );
      }
      const encodedContent =
        content.encoding === "base64" && content.content
          ? content.content
          : (await readJson(`${base}/git/blobs/${content.sha}`, blobSchema))
              .content;
      const bytes = decodeBase64(encodedContent);
      const pulls = await readJson(
        `${base}/commits/${encodeURIComponent(commit.sha)}/pulls?per_page=100`,
        z.array(pullRequestSchema)
      );
      const pullRequest =
        pulls.find((candidate) => candidate.state === "open") ??
        pulls[0] ??
        null;
      const reviews = pullRequest
        ? await readJson(
            `${base}/pulls/${pullRequest.number}/reviews?per_page=100`,
            z.array(reviewSchema)
          )
        : [];
      const checks = await readJson(
        `${base}/commits/${encodeURIComponent(commit.sha)}/check-runs?per_page=100`,
        checkRunsSchema
      );
      const reviewsSummary = reviewCounts(reviews);
      const checksSummary = checkState(checks);

      return governedArtifactSnapshotSchema.parse({
        blobSha: content.sha,
        checksState: checksSummary.state,
        checksSuccessful: checksSummary.successful,
        checksTotal: checks.total_count,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
        observedCommit: commit.sha,
        path,
        provider: "github",
        pullRequestNumber: pullRequest?.number ?? null,
        pullRequestState:
          pullRequest?.state === "open" || pullRequest?.state === "closed"
            ? pullRequest.state
            : null,
        pullRequestUrl: pullRequest?.html_url ?? null,
        repository,
        requestedRef,
        reviewsApproved: reviewsSummary.approved,
        reviewsChangesRequested: reviewsSummary.changesRequested,
        url: content.html_url,
      });
    },
  };
}
