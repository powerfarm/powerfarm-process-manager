"use client";

import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { ProcessGraphList } from "@/components/processes/process-graph-list";
import { ProcessLogList } from "@/components/processes/process-log-list";
import { ProcessStatus } from "@/components/processes/process-status";
import { ProcessSummary } from "@/components/processes/process-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ProcessProjection,
  ProcessSummary as ProcessSummaryData,
} from "@/lib/processes/contracts";
import { formatProcessNumber } from "@/lib/processes/format";
import {
  type ProcessPanelSection,
  useProcessDetail,
} from "@/lib/processes/use-process-detail";
import { cn } from "@/lib/utils";

const SECTIONS: readonly {
  readonly id: ProcessPanelSection;
  readonly label: string;
}[] = [
  { id: "summary", label: "Resumo" },
  { id: "graph", label: "Grafo" },
  { id: "log", label: "Log" },
];

export function ProcessPanel({
  isProcessing,
  open,
  process: streamProcess,
  processStoreReady,
  projection: streamProjection,
}: {
  readonly isProcessing: boolean;
  readonly open: boolean;
  readonly process: ProcessSummaryData;
  readonly processStoreReady: boolean;
  readonly projection: ProcessProjection | null;
}) {
  const [section, setSection] = useState<ProcessPanelSection>("summary");
  const [kind, setKind] = useState("");
  const [relation, setRelation] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const graphQuery = useMemo(
    () => ({
      kind: kind.trim() || undefined,
      nodeId: selectedNodeId,
      relation: relation.trim() || undefined,
    }),
    [kind, relation, selectedNodeId]
  );
  const detail = useProcessDetail({
    graphQuery,
    open: open && processStoreReady,
    process: streamProcess,
    projection: streamProjection,
    section,
  });
  const process = detail.process ?? streamProcess;
  const projection = detail.projection ?? streamProjection;

  return (
    <div className="flex max-h-[min(72vh,38rem)] min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-start justify-between gap-3 pr-7">
          <div className="min-w-0">
            <p className="font-mono text-[9px] text-primary uppercase tracking-[0.18em]">
              {formatProcessNumber(process.number)} · memória de processo
            </p>
            <h2 className="mt-1 truncate font-display font-medium text-xl tracking-[-0.02em]">
              {process.title}
            </h2>
          </div>
          <ProcessStatus
            className="mt-0.5 shrink-0"
            isProcessing={isProcessing}
            status={process.status}
          />
        </div>
        <div
          aria-label="Seções do processo"
          className="mt-4 grid grid-cols-3 rounded-lg bg-muted/70 p-1"
          role="tablist"
        >
          {SECTIONS.map((item) => (
            <button
              aria-selected={section === item.id}
              className={cn(
                "rounded-md px-2 py-1.5 font-medium text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                section === item.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              key={item.id}
              onClick={() => setSection(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {processStoreReady ? (
          detail.isStale ? (
            <PanelNotice
              detail="A sessão ainda guarda o vínculo, mas este processo não está mais legível para a conta atual. Peça ao lead para localizar ou desativar o processo."
              title="Vínculo de processo desatualizado"
            />
          ) : detail.error ? (
            <PanelNotice
              detail={detail.error}
              title="Não foi possível atualizar"
            />
          ) : (
            <>
              {detail.isLoading ? (
                <div className="mb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2Icon className="size-3 animate-spin motion-reduce:animate-none" />
                  Atualizando leitura…
                </div>
              ) : null}
              {section === "summary" ? (
                <ProcessSummary
                  isProcessing={isProcessing}
                  process={process}
                  projection={projection}
                />
              ) : null}
              {section === "graph" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label="Filtrar por tipo de nó"
                      className="h-8 font-mono text-[10px]"
                      onChange={(event) => setKind(event.target.value)}
                      placeholder="tipo de nó"
                      value={kind}
                    />
                    <Input
                      aria-label="Filtrar por relação"
                      className="h-8 font-mono text-[10px]"
                      onChange={(event) => setRelation(event.target.value)}
                      placeholder="relação"
                      value={relation}
                    />
                  </div>
                  {selectedNodeId ? (
                    <Button
                      className="h-7 px-2 text-[10px]"
                      onClick={() => setSelectedNodeId(undefined)}
                      type="button"
                      variant="ghost"
                    >
                      Limpar recorte do nó {selectedNodeId}
                    </Button>
                  ) : null}
                  <ProcessGraphList
                    isLoading={detail.isLoading}
                    onLoadMore={() => void detail.loadMore("graph")}
                    onSelectNode={setSelectedNodeId}
                    page={detail.graph}
                    selectedNodeId={selectedNodeId}
                  />
                </div>
              ) : null}
              {section === "log" ? (
                <ProcessLogList
                  isLoading={detail.isLoading}
                  onLoadMore={() => void detail.loadMore("log")}
                  page={detail.events}
                />
              ) : null}
            </>
          )
        ) : (
          <PanelNotice
            detail="Configure e migre o Postgres do projeto para consultar este processo. A conversa continua disponível."
            title="Memória de processo indisponível"
          />
        )}
      </div>
      <div className="shrink-0 border-t px-4 py-2 font-mono text-[9px] text-muted-foreground">
        Somente leitura · versão observada {process.version}
      </div>
    </div>
  );
}

function PanelNotice({
  detail,
  title,
}: {
  readonly detail: string;
  readonly title: string;
}) {
  return (
    <div className="rounded-lg border border-dashed p-5 text-center">
      <AlertCircleIcon className="mx-auto size-5 text-muted-foreground" />
      <p className="mt-2 font-medium text-sm">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-xs leading-5">
        {detail}
      </p>
    </div>
  );
}
