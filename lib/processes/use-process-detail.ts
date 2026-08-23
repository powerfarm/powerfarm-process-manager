"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createProcessClient,
  type ProcessDetail,
  type ProcessEventPageData,
  type ProcessGraphPageData,
} from "@/lib/processes/client";
import type {
  ProcessProjection,
  ProcessSummary,
} from "@/lib/processes/contracts";

export type ProcessPanelSection = "summary" | "graph" | "log";

export interface ProcessDetailFetcher {
  readonly detail: (
    processId: string,
    signal: AbortSignal
  ) => Promise<ProcessDetail | null>;
  readonly events: (
    processId: string,
    options: { readonly cursor?: string; readonly limit?: number },
    signal: AbortSignal
  ) => Promise<ProcessEventPageData | null>;
  readonly graph: (
    processId: string,
    options: {
      readonly cursor?: string;
      readonly kind?: string;
      readonly limit?: number;
      readonly nodeId?: string;
      readonly relation?: string;
    },
    signal: AbortSignal
  ) => Promise<ProcessGraphPageData | null>;
}

export interface ProcessDetailState {
  readonly error: string | null;
  readonly events: ProcessEventPageData | null;
  readonly graph: ProcessGraphPageData | null;
  readonly isLoading: boolean;
  readonly isStale: boolean;
  readonly process: ProcessSummary | null;
  readonly projection: ProcessProjection | null;
  readonly section: ProcessPanelSection;
}

interface LoadProcessDetailInput {
  readonly graphQuery?: {
    readonly kind?: string;
    readonly nodeId?: string;
    readonly relation?: string;
  };
  readonly processId: string;
  readonly section: ProcessPanelSection;
  readonly streamProcess?: ProcessSummary | null;
  readonly streamProjection?: ProcessProjection | null;
}

const EMPTY_DETAIL_STATE: ProcessDetailState = {
  error: null,
  events: null,
  graph: null,
  isLoading: false,
  isStale: false,
  process: null,
  projection: null,
  section: "summary",
};

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createProcessDetailMachine(fetcher: ProcessDetailFetcher) {
  let state = EMPTY_DETAIL_STATE;
  let controller: AbortController | null = null;
  let currentGraphQuery: LoadProcessDetailInput["graphQuery"];
  let revision = 0;
  const listeners = new Set<(next: ProcessDetailState) => void>();

  function setState(next: ProcessDetailState) {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  }

  async function load(input: LoadProcessDetailInput): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    const currentController = controller;
    revision += 1;
    const currentRevision = revision;
    currentGraphQuery = input.graphQuery;
    const sameProcess = state.process?.id === input.processId;
    const streamProcess = input.streamProcess ?? null;
    const streamProjection = input.streamProjection ?? null;
    const initialProcess =
      streamProcess &&
      (!(sameProcess && state.process) ||
        streamProcess.version >= state.process.version)
        ? streamProcess
        : sameProcess
          ? state.process
          : null;
    const initialProjection =
      initialProcess === streamProcess
        ? streamProjection
        : sameProcess
          ? state.projection
          : null;
    setState({
      error: null,
      events: sameProcess ? state.events : null,
      graph: sameProcess ? state.graph : null,
      isLoading: true,
      isStale: false,
      process: initialProcess,
      projection: initialProjection,
      section: input.section,
    });

    try {
      const detail = await fetcher.detail(
        input.processId,
        currentController.signal
      );
      if (currentRevision !== revision) {
        return;
      }
      if (!detail) {
        setState({ ...state, isLoading: false, isStale: true });
        return;
      }
      const currentVersion = state.process?.version ?? -1;
      if (detail.process.version >= currentVersion) {
        setState({
          ...state,
          process: detail.process,
          projection: detail.projection,
        });
      }

      if (input.section === "graph") {
        const graph = await fetcher.graph(
          input.processId,
          { limit: 50, ...input.graphQuery },
          currentController.signal
        );
        if (currentRevision !== revision) {
          return;
        }
        setState({ ...state, graph });
      } else if (input.section === "log") {
        const events = await fetcher.events(
          input.processId,
          { limit: 50 },
          currentController.signal
        );
        if (currentRevision !== revision) {
          return;
        }
        setState({ ...state, events });
      }
      setState({ ...state, isLoading: false });
    } catch (error) {
      if (isAbort(error) || currentRevision !== revision) {
        return;
      }
      setState({
        ...state,
        error:
          error instanceof Error
            ? error.message
            : "Process details could not be loaded.",
        isLoading: false,
      });
    }
  }

  async function loadMore(section: "graph" | "log"): Promise<void> {
    const processId = state.process?.id;
    const cursor =
      section === "graph" ? state.graph?.nextCursor : state.events?.nextCursor;
    if (!(processId && cursor)) {
      return;
    }
    controller?.abort();
    controller = new AbortController();
    const currentController = controller;
    setState({ ...state, isLoading: true });
    try {
      if (section === "graph") {
        const page = await fetcher.graph(
          processId,
          { cursor, limit: 50, ...currentGraphQuery },
          currentController.signal
        );
        setState({
          ...state,
          graph:
            page && state.graph
              ? {
                  edges: [...state.graph.edges, ...page.edges],
                  nextCursor: page.nextCursor,
                  nodes: [...state.graph.nodes, ...page.nodes],
                }
              : page,
          isLoading: false,
        });
      } else {
        const page = await fetcher.events(
          processId,
          { cursor, limit: 50 },
          currentController.signal
        );
        setState({
          ...state,
          events:
            page && state.events
              ? {
                  items: [...state.events.items, ...page.items],
                  nextCursor: page.nextCursor,
                }
              : page,
          isLoading: false,
        });
      }
    } catch (error) {
      if (!isAbort(error)) {
        setState({
          ...state,
          error:
            error instanceof Error
              ? error.message
              : "More process details could not be loaded.",
          isLoading: false,
        });
      }
    }
  }

  return {
    abort() {
      controller?.abort();
    },
    getState: () => state,
    load,
    loadMore,
    subscribe(listener: (next: ProcessDetailState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useProcessDetail({
  graphQuery,
  open,
  process,
  projection,
  section,
}: {
  readonly graphQuery?: LoadProcessDetailInput["graphQuery"];
  readonly open: boolean;
  readonly process: ProcessSummary;
  readonly projection: ProcessProjection | null;
  readonly section: ProcessPanelSection;
}) {
  const machine = useMemo(
    () => createProcessDetailMachine(createProcessClient()),
    []
  );
  const [state, setState] = useState<ProcessDetailState>(() => ({
    ...EMPTY_DETAIL_STATE,
    process,
    projection,
  }));

  useEffect(() => machine.subscribe(setState), [machine]);
  useEffect(() => {
    if (!open) {
      machine.abort();
      return;
    }
    void machine.load({
      graphQuery,
      processId: process.id,
      section,
      streamProcess: process,
      streamProjection: projection,
    });
    return () => machine.abort();
  }, [graphQuery, machine, open, process, projection, section]);

  return {
    ...state,
    loadMore: (target: "graph" | "log") => machine.loadMore(target),
  };
}
