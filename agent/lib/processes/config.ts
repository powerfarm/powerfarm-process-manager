import { defineState } from "eve/context";

export interface ActiveProcessState {
  readonly processId: string | null;
  readonly projectionVersion: number | null;
}

export const activeProcessState = defineState<ActiveProcessState>(
  "marketing-team.active-process",
  () => ({ processId: null, projectionVersion: null })
);

export const PROCESS_EVENT_PAGE_SIZE = 50;
export const PROCESS_GRAPH_PAGE_SIZE = 50;
export const PROCESS_SEARCH_LIMIT = 20;
