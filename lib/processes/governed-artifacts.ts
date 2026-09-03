import { z } from "zod";
import type { JsonValue } from "@/lib/processes/contracts";

export const GOVERNED_ARTIFACT_KIND = "governed_artifact";

export const GOVERNED_ARTIFACT_METADATA_KEYS = [
  "provider",
  "repository",
  "path",
  "requested_ref",
  "observed_commit",
  "content_sha256",
  "github_blob_sha",
  "observed_at",
  "url",
  "pull_request_number",
  "pull_request_state",
  "pull_request_url",
  "reviews_approved",
  "reviews_changes_requested",
  "checks_state",
  "checks_total",
  "checks_successful",
] as const;

const gitObjectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{7,64}$/i, "Expected a Git object id");

export const governedArtifactSnapshotSchema = z
  .object({
    blobSha: gitObjectIdSchema,
    checksState: z.enum(["none", "pending", "passing", "failing"]),
    checksSuccessful: z.number().int().nonnegative(),
    checksTotal: z.number().int().nonnegative(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    observedCommit: gitObjectIdSchema,
    path: z.string().trim().min(1).max(1024),
    provider: z.literal("github"),
    pullRequestNumber: z.number().int().positive().nullable(),
    pullRequestState: z.enum(["open", "closed"]).nullable(),
    pullRequestUrl: z.url().nullable(),
    repository: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    requestedRef: z.string().trim().min(1).max(256),
    reviewsApproved: z.number().int().nonnegative(),
    reviewsChangesRequested: z.number().int().nonnegative(),
    url: z.url(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.checksSuccessful > snapshot.checksTotal) {
      context.addIssue({
        code: "custom",
        message: "Successful checks cannot exceed total checks",
      });
    }
    const pullRequestFields = [
      snapshot.pullRequestNumber,
      snapshot.pullRequestState,
      snapshot.pullRequestUrl,
    ];
    const populatedPullRequestFields = pullRequestFields.filter(
      (value) => value !== null
    ).length;
    if (
      populatedPullRequestFields !== 0 &&
      populatedPullRequestFields !== pullRequestFields.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Pull request identity must be complete or absent",
      });
    }
  });

export type GovernedArtifactSnapshot = z.infer<
  typeof governedArtifactSnapshotSchema
>;

export function governedArtifactMetadata(
  snapshot: GovernedArtifactSnapshot,
  observedAt: string
): Readonly<Record<string, JsonValue>> {
  const artifact = governedArtifactSnapshotSchema.parse(snapshot);
  return {
    checks_state: artifact.checksState,
    checks_successful: artifact.checksSuccessful,
    checks_total: artifact.checksTotal,
    content_sha256: artifact.contentSha256,
    github_blob_sha: artifact.blobSha,
    observed_at: observedAt,
    observed_commit: artifact.observedCommit,
    path: artifact.path,
    provider: artifact.provider,
    pull_request_number: artifact.pullRequestNumber,
    pull_request_state: artifact.pullRequestState,
    pull_request_url: artifact.pullRequestUrl,
    repository: artifact.repository,
    requested_ref: artifact.requestedRef,
    reviews_approved: artifact.reviewsApproved,
    reviews_changes_requested: artifact.reviewsChangesRequested,
    url: artifact.url,
  };
}

export function isGovernedArtifactMetadataKey(key: string): boolean {
  return (GOVERNED_ARTIFACT_METADATA_KEYS as readonly string[]).includes(key);
}
