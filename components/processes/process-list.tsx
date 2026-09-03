"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProcessPanel } from "@/components/processes/process-panel";
import { getProcessStatusPresentation } from "@/components/processes/process-status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { createProcessClient } from "@/lib/processes/client";
import type { ProcessSummary } from "@/lib/processes/contracts";
import { formatProcessNumber } from "@/lib/processes/format";
import { cn } from "@/lib/utils";

const PROCESS_LIST_LIMIT = 12;

/**
 * The person's processes, listed beside their conversations.
 *
 * @remarks
 * Process memory outlives the chat that opened it, so without a list the only way back into a
 * process is a conversation that already touched one. This reads the same owner-scoped route the
 * panel uses and opens the same panel, so nothing here can write.
 */
export function ProcessList({
  activeChatId,
  processStoreReady,
}: {
  readonly activeChatId: string | null;
  readonly processStoreReady: boolean;
}) {
  const [items, setItems] = useState<readonly ProcessSummary[]>([]);
  const [selected, setSelected] = useState<ProcessSummary | null>(null);
  const client = useMemo(() => createProcessClient(), []);

  useEffect(() => {
    if (!processStoreReady) {
      setItems([]);
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const page = await client.list(
          { limit: PROCESS_LIST_LIMIT },
          controller.signal
        );

        if (!controller.signal.aborted) {
          setItems(page?.items ?? []);
        }
      } catch {
        if (!controller.signal.aborted) {
          setItems([]);
        }
      }
    })();

    return () => controller.abort();
  }, [activeChatId, client, processStoreReady]);

  const closePanel = useCallback((open: boolean) => {
    if (!open) {
      setSelected(null);
    }
  }, []);

  if (!(processStoreReady && items.length)) {
    return null;
  }

  return (
    <div className="mt-4">
      <p className="px-2 pb-1 font-mono text-[9px] text-muted-foreground/70 uppercase tracking-[0.18em]">
        Processos
      </p>
      {items.map((process) => (
        <ProcessRow
          isSelected={selected?.id === process.id}
          key={process.id}
          onSelect={setSelected}
          process={process}
        />
      ))}
      <Dialog onOpenChange={closePanel} open={Boolean(selected)}>
        <DialogContent className="max-w-[min(29rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Detalhes do processo</DialogTitle>
          <DialogDescription className="sr-only">
            Projeção, grafo e log somente leitura do processo selecionado.
          </DialogDescription>
          {selected ? (
            <ProcessPanel
              isProcessing={false}
              open={Boolean(selected)}
              process={selected}
              processStoreReady={processStoreReady}
              projection={null}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProcessRow({
  isSelected,
  onSelect,
  process,
}: {
  readonly isSelected: boolean;
  readonly onSelect: (process: ProcessSummary) => void;
  readonly process: ProcessSummary;
}) {
  const presentation = getProcessStatusPresentation(process.status, false);
  const StatusIcon = presentation.icon;

  return (
    <button
      className={cn(
        "mb-0.5 flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted/50 hover:text-foreground",
        isSelected ? "bg-muted/50 text-foreground" : "text-muted-foreground"
      )}
      onClick={() => onSelect(process)}
      type="button"
    >
      <StatusIcon
        aria-hidden
        className={cn("size-3.5 shrink-0", presentation.tokenClass)}
      />
      <span className="block truncate text-[13px]">{process.title}</span>
      <span className="sr-only">
        {formatProcessNumber(process.number)}. {presentation.description}
      </span>
    </button>
  );
}
