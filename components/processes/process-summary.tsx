import { HashIcon, TagsIcon } from "lucide-react";
import { ProcessStatus } from "@/components/processes/process-status";
import type {
  ProcessProjection,
  ProcessSummary as ProcessSummaryData,
} from "@/lib/processes/contracts";
import { formatProcessNumber } from "@/lib/processes/format";

function projectedValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

export function ProcessSummary({
  isProcessing,
  process,
  projection,
}: {
  readonly isProcessing: boolean;
  readonly process: ProcessSummaryData;
  readonly projection: ProcessProjection | null;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        <div className="bg-card p-3">
          <p className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.15em]">
            Estado
          </p>
          <ProcessStatus
            className="mt-2"
            isProcessing={isProcessing}
            status={process.status}
          />
        </div>
        <div className="bg-card p-3">
          <p className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.15em]">
            Versão
          </p>
          <p className="mt-1.5 font-mono font-semibold text-lg tabular-nums">
            v{process.version}
          </p>
        </div>
        <div className="col-span-2 bg-card p-3 sm:col-span-1">
          <p className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.15em]">
            Grafo vivo
          </p>
          <p className="mt-1.5 font-mono text-sm tabular-nums">
            {projection
              ? `${projection.metrics.liveNodes} nós · ${projection.metrics.liveEdges} relações`
              : "—"}
          </p>
        </div>
      </div>

      {projection?.summary ? (
        <p className="rounded-lg border border-primary/15 bg-primary/[0.04] p-3 text-sm leading-6">
          {projection.summary}
        </p>
      ) : null}

      {projection?.columns.length ? (
        <div className="overflow-hidden rounded-lg border">
          {projection.columns.map((column) => (
            <div
              className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.5fr)] gap-3 border-b px-3 py-2.5 last:border-b-0"
              key={column.key}
            >
              <p className="text-muted-foreground text-xs">{column.label}</p>
              <p className="min-w-0 break-words text-right font-medium text-xs">
                {projectedValue(column.value)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-xs">
          As colunas legíveis aparecem aqui quando o lead as define no grafo.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-xs">
        <span className="inline-flex items-center gap-1.5 font-mono">
          <HashIcon className="size-3" />
          {formatProcessNumber(process.number)}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <TagsIcon className="size-3 shrink-0" />
          {process.tags.length ? process.tags.join(" · ") : "Sem tags"}
        </span>
      </div>
    </div>
  );
}
