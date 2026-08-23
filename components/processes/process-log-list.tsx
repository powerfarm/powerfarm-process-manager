import { HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProcessEventPageData } from "@/lib/processes/client";
import type { JsonValue, ProcessEvent } from "@/lib/processes/contracts";

function operationSummary(event: ProcessEvent): string | null {
  const result = event.payload.result;
  if (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    typeof (result as Readonly<Record<string, JsonValue>>).operationSummary ===
      "string"
  ) {
    return (result as Readonly<Record<string, JsonValue>>)
      .operationSummary as string;
  }
  return null;
}

export function ProcessLogList({
  isLoading,
  onLoadMore,
  page,
}: {
  readonly isLoading: boolean;
  readonly onLoadMore: () => void;
  readonly page: ProcessEventPageData | null;
}) {
  if (!page?.items.length) {
    return (
      <div className="rounded-lg border border-dashed p-5 text-center">
        <HistoryIcon className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-sm">Nenhum evento registrado.</p>
        <p className="mt-1 text-muted-foreground text-xs">
          O log aparece depois da primeira mudança confirmada.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-0 overflow-hidden rounded-lg border">
        {page.items.map((event) => (
          <li className="border-b p-3 last:border-b-0" key={event.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-xs">{event.operationType}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {operationSummary(event) ?? event.reason}
                </p>
              </div>
              <span className="shrink-0 rounded bg-primary/[0.08] px-1.5 py-0.5 font-mono text-[9px] text-primary">
                v{event.processVersion}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
              <dt>quando</dt>
              <dd>{new Date(event.createdAt).toLocaleString("pt-PT")}</dd>
              <dt>ferramenta</dt>
              <dd className="truncate">{event.toolName}</dd>
              <dt>sessão</dt>
              <dd className="truncate">{event.eveSessionId}</dd>
              <dt>turno</dt>
              <dd className="truncate">{event.turnId}</dd>
              <dt>motivo</dt>
              <dd>{event.reason || "—"}</dd>
            </dl>
          </li>
        ))}
      </ol>
      {page.nextCursor ? (
        <Button
          className="w-full"
          disabled={isLoading}
          onClick={onLoadMore}
          size="sm"
          type="button"
          variant="outline"
        >
          {isLoading ? "Carregando…" : "Carregar eventos anteriores"}
        </Button>
      ) : null}
    </div>
  );
}
