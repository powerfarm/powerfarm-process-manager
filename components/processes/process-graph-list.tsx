import { ArrowRightIcon, CircleIcon, NetworkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProcessGraphPageData } from "@/lib/processes/client";
import { cn } from "@/lib/utils";

function metadataPreview(metadata: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(metadata).slice(0, 3);
  return entries.length
    ? entries
        .map(
          ([key, value]) =>
            `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`
        )
        .join(" · ")
    : "Sem metadados visíveis";
}

export function ProcessGraphList({
  isLoading,
  onLoadMore,
  onSelectNode,
  page,
  selectedNodeId,
}: {
  readonly isLoading: boolean;
  readonly onLoadMore: () => void;
  readonly onSelectNode: (nodeId: string | undefined) => void;
  readonly page: ProcessGraphPageData | null;
  readonly selectedNodeId?: string;
}) {
  if (!page || (page.nodes.length === 0 && page.edges.length === 0)) {
    return (
      <div className="rounded-lg border border-dashed p-5 text-center">
        <NetworkIcon className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-sm">Nenhum nó corresponde a este recorte.</p>
        <p className="mt-1 text-muted-foreground text-xs">
          Ajuste os filtros ou peça ao lead para consultar outra parte do
          processo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative space-y-1 before:absolute before:top-4 before:bottom-4 before:left-[0.69rem] before:w-px before:bg-border">
        {page.nodes.map((node) => (
          <button
            className={cn(
              "relative flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selectedNodeId === node.id &&
                "bg-primary/[0.07] ring-1 ring-primary/20"
            )}
            key={node.id}
            onClick={() =>
              onSelectNode(selectedNodeId === node.id ? undefined : node.id)
            }
            type="button"
          >
            <span className="relative z-10 mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border bg-background">
              <CircleIcon className="size-1.5 fill-primary text-primary" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-sm">
                  {node.label}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-primary uppercase tracking-wider">
                  {node.kind}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {metadataPreview(node.metadata)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {page.edges.length ? (
        <div>
          <p className="mb-2 font-mono text-[9px] text-muted-foreground uppercase tracking-[0.16em]">
            Relações
          </p>
          <div className="space-y-1 rounded-lg border p-2">
            {page.edges.map((edge) => (
              <div
                className="flex min-w-0 items-center gap-2 px-1 py-1.5 font-mono text-[10px]"
                key={edge.id}
              >
                <span className="truncate">{edge.sourceNodeId}</span>
                <ArrowRightIcon className="size-3 shrink-0 text-primary" />
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  {edge.relation}
                </span>
                <ArrowRightIcon className="size-3 shrink-0 text-primary" />
                <span className="truncate">{edge.targetNodeId}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {page.nextCursor ? (
        <Button
          className="w-full"
          disabled={isLoading}
          onClick={onLoadMore}
          size="sm"
          type="button"
          variant="outline"
        >
          {isLoading ? "Carregando…" : "Carregar mais"}
        </Button>
      ) : null}
    </div>
  );
}
