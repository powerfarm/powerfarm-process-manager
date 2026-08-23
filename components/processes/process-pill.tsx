"use client";

import { ChevronUpIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";
import { ProcessPanel } from "@/components/processes/process-panel";
import { ProcessStatus } from "@/components/processes/process-status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatProcessNumber } from "@/lib/processes/format";
import type { ProcessUiState } from "@/lib/processes/ui-projection";
import { useMediaQuery } from "@/lib/use-media-query";

export function ProcessPill({
  processStoreReady,
  state,
}: {
  readonly processStoreReady: boolean;
  readonly state: ProcessUiState;
}) {
  const [open, setOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 640px)");
  const process = state.activeProcess;
  if (!process) {
    return null;
  }

  const trigger = (
    <button
      aria-label={`Abrir processo ${formatProcessNumber(process.number)}: ${process.title}`}
      className="group relative inline-flex h-7 min-w-0 max-w-[min(26rem,72vw)] items-center gap-1.5 overflow-hidden rounded-full border border-primary/25 bg-primary/[0.06] pr-2 pl-1.5 text-left shadow-[0_0_18px_-10px_var(--color-primary)] transition-colors hover:border-primary/45 hover:bg-primary/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      type="button"
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <GitBranchIcon className="size-2.5" />
        {state.isProcessing ? (
          <span className="absolute -top-px -right-px size-1.5 animate-pulse rounded-full bg-[var(--signal)] ring-2 ring-background motion-reduce:animate-none" />
        ) : null}
      </span>
      <span className="shrink-0 font-mono text-[9px] text-primary tracking-wide">
        {formatProcessNumber(process.number)}
      </span>
      <span className="truncate text-[11px]">{process.title}</span>
      <span className="hidden h-3 w-px shrink-0 bg-border sm:block" />
      <ProcessStatus
        className="shrink-0"
        compact
        isProcessing={state.isProcessing}
        status={process.status}
      />
      <ChevronUpIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180" />
    </button>
  );

  const panel = (
    <ProcessPanel
      isProcessing={state.isProcessing}
      open={open}
      process={process}
      processStoreReady={processStoreReady}
      projection={state.projection}
    />
  );

  if (desktop) {
    return (
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(29rem,calc(100vw-2rem))] overflow-hidden p-0"
          side="top"
        >
          {panel}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="top-auto bottom-0 max-h-[86dvh] max-w-none translate-y-0 gap-0 rounded-b-none p-0 sm:hidden">
        <DialogTitle className="sr-only">Detalhes do processo</DialogTitle>
        <DialogDescription className="sr-only">
          Projeção, grafo e log somente leitura do processo ativo.
        </DialogDescription>
        {panel}
      </DialogContent>
    </Dialog>
  );
}
