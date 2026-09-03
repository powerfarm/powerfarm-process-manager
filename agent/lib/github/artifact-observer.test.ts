import { describe, expect, it, vi } from "vitest";
import { createGitHubArtifactObserver } from "#lib/github/artifact-observer.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

describe("GitHubArtifactObserver", () => {
  it("resolves an immutable file observation with review and check state", async () => {
    const token = vi.fn(async () => "installation-token");
    const request = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/commits/main/pulls")) {
        throw new Error(
          "The observer must query pull requests by resolved SHA"
        );
      }
      if (url.endsWith("/commits/main")) {
        return Promise.resolve(jsonResponse({ sha: "a".repeat(40) }));
      }
      if (url.includes("/contents/target/future-body-narrative.md")) {
        return Promise.resolve(
          jsonResponse({
            content: Buffer.from("future body\n").toString("base64"),
            encoding: "base64",
            html_url:
              "https://github.com/powerfarm/planning/blob/aaaaaaaa/target/future-body-narrative.md",
            sha: "b".repeat(40),
            type: "file",
          })
        );
      }
      if (url.includes(`/commits/${"a".repeat(40)}/pulls`)) {
        return Promise.resolve(
          jsonResponse([
            {
              html_url: "https://github.com/powerfarm/planning/pull/17",
              number: 17,
              state: "open",
            },
          ])
        );
      }
      if (url.endsWith("/pulls/17/reviews?per_page=100")) {
        return Promise.resolve(
          jsonResponse([
            {
              state: "APPROVED",
              submitted_at: "2026-09-03T10:00:00.000Z",
              user: { id: 1, login: "reviewer" },
            },
          ])
        );
      }
      if (url.includes(`/commits/${"a".repeat(40)}/check-runs`)) {
        return Promise.resolve(
          jsonResponse({
            check_runs: [
              { conclusion: "success", status: "completed" },
              { conclusion: "neutral", status: "completed" },
            ],
            total_count: 2,
          })
        );
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });
    const observer = createGitHubArtifactObserver({
      allowedRepositories: ["powerfarm/planning"],
      fetch: request as typeof fetch,
      getToken: token,
    });

    const observation = await observer.observe({
      path: "target/future-body-narrative.md",
      repository: "powerfarm/planning",
      requestedRef: "main",
    });

    expect(observation).toMatchObject({
      blobSha: "b".repeat(40),
      checksState: "passing",
      checksSuccessful: 2,
      checksTotal: 2,
      observedCommit: "a".repeat(40),
      pullRequestNumber: 17,
      reviewsApproved: 1,
    });
    expect(observation.contentSha256).toMatch(SHA256_PATTERN);
    expect(token).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(`ref=${"a".repeat(40)}`),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer installation-token",
        }),
      })
    );
  });

  it("rejects a repository outside the installation allowlist before minting a token", async () => {
    const token = vi.fn(async () => "installation-token");
    const observer = createGitHubArtifactObserver({
      allowedRepositories: ["powerfarm/planning"],
      getToken: token,
    });

    await expect(
      observer.observe({
        path: "README.md",
        repository: "someone/elsewhere",
        requestedRef: "main",
      })
    ).rejects.toMatchObject({ code: "artifact_not_allowed" });
    expect(token).not.toHaveBeenCalled();
  });
});
