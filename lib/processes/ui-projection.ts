import type { MessageStreamEvent } from "eve/client";
import {
  PROCESS_TOOL_NAMES,
  type ProcessProjection,
  type ProcessSummary,
  processToolResultSchema,
} from "@/lib/processes/contracts";

export interface ProcessUiState {
  readonly activeProcess: ProcessSummary | null;
  readonly isProcessing: boolean;
  readonly projection: ProcessProjection | null;
}

export const EMPTY_PROCESS_UI_STATE: ProcessUiState = {
  activeProcess: null,
  isProcessing: false,
  projection: null,
};

const PROCESS_TOOLS = new Set<string>(PROCESS_TOOL_NAMES);
const PROCESS_TERMINAL_EVENTS = new Set<MessageStreamEvent["type"]>([
  "session.completed",
  "session.failed",
  "session.waiting",
  "turn.cancelled",
  "turn.completed",
  "turn.failed",
]);

export function reduceProcessEvents(
  events: readonly MessageStreamEvent[],
  isBusy: boolean
): ProcessUiState {
  let activeProcess: ProcessSummary | null = null;
  let projection: ProcessProjection | null = null;
  const pendingProcessCalls = new Set<string>();

  for (const event of events) {
    if (event.type === "actions.requested") {
      for (const action of event.data.actions) {
        if (action.kind === "tool-call" && PROCESS_TOOLS.has(action.toolName)) {
          pendingProcessCalls.add(action.callId);
        }
      }
      continue;
    }

    if (event.type === "action.result") {
      const action = event.data.result;
      if (
        action.kind !== "tool-result" ||
        !PROCESS_TOOLS.has(action.toolName)
      ) {
        continue;
      }
      pendingProcessCalls.delete(action.callId);
      if (event.data.status !== "completed" || action.isError) {
        continue;
      }
      const parsed = processToolResultSchema.safeParse(action.output);
      if (!parsed.success) {
        continue;
      }
      const result = parsed.data;
      if (action.toolName === "deactivate_process" && !result.active) {
        activeProcess = null;
        projection = null;
        continue;
      }
      if (!(result.active && result.process && result.projection)) {
        continue;
      }
      if (
        activeProcess &&
        result.process.id === activeProcess.id &&
        result.process.version < activeProcess.version
      ) {
        continue;
      }
      activeProcess = result.process;
      projection = result.projection;
      continue;
    }

    if (PROCESS_TERMINAL_EVENTS.has(event.type)) {
      pendingProcessCalls.clear();
    }
  }

  return {
    activeProcess,
    isProcessing: isBusy && pendingProcessCalls.size > 0,
    projection,
  };
}
