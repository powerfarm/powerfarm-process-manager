import type { ProcessProjection } from "@/lib/processes/contracts";

export type ProcessErrorCode =
  | "artifact_not_allowed"
  | "artifact_observation_failed"
  | "process_not_found"
  | "process_store_unavailable"
  | "version_conflict"
  | "invalid_graph_operation"
  | "projection_limit_exceeded"
  | "replayed_mutation";

const HTTP_STATUS_BY_CODE: Readonly<Record<ProcessErrorCode, number>> = {
  artifact_not_allowed: 403,
  artifact_observation_failed: 502,
  invalid_graph_operation: 400,
  process_not_found: 404,
  process_store_unavailable: 503,
  projection_limit_exceeded: 400,
  replayed_mutation: 200,
  version_conflict: 409,
};

export class ProcessError extends Error {
  readonly code: ProcessErrorCode;
  readonly currentVersion: number | undefined;
  readonly projection: ProcessProjection | undefined;

  constructor(
    code: ProcessErrorCode,
    message: string,
    details: {
      readonly currentVersion?: number;
      readonly projection?: ProcessProjection;
    } = {}
  ) {
    super(message);
    this.name = "ProcessError";
    this.code = code;
    this.currentVersion = details.currentVersion;
    this.projection = details.projection;
  }
}

export function processErrorHttpStatus(code: ProcessErrorCode): number {
  return HTTP_STATUS_BY_CODE[code];
}

export function toProcessError(error: unknown): ProcessError {
  if (error instanceof ProcessError) {
    return error;
  }
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code in HTTP_STATUS_BY_CODE
  ) {
    const candidate = error as Error & {
      readonly code: ProcessErrorCode;
      readonly currentVersion?: number;
      readonly projection?: ProcessProjection;
    };
    return new ProcessError(candidate.code, candidate.message, {
      currentVersion: candidate.currentVersion,
      projection: candidate.projection,
    });
  }
  return new ProcessError(
    "process_store_unavailable",
    "Process memory is temporarily unavailable."
  );
}
