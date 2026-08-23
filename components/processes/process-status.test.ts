import { describe, expect, it } from "vitest";
import { getProcessStatusPresentation } from "@/components/processes/process-status";
import {
  PROCESS_STATUS_LABELS,
  type ProcessStatus,
} from "@/lib/processes/contracts";

describe("process status presentation", () => {
  it("defines a Portuguese label for every durable state", () => {
    expect(PROCESS_STATUS_LABELS).toEqual({
      archived: "Arquivado",
      blocked: "Bloqueado",
      completed: "Concluído",
      in_progress: "Em andamento",
      waiting: "Aguardando",
    });
  });

  it.each(Object.keys(PROCESS_STATUS_LABELS) as ProcessStatus[])(
    "maps %s to an icon, visual token, and color-independent text",
    (status) => {
      const presentation = getProcessStatusPresentation(status, false);

      expect(presentation.icon).toBeTruthy();
      expect(presentation.tokenClass).toContain("text-");
      expect(presentation.description).toContain(PROCESS_STATUS_LABELS[status]);
    }
  );

  it("keeps transient processing separate from the durable label", () => {
    const presentation = getProcessStatusPresentation("blocked", true);

    expect(presentation.label).toBe("Bloqueado");
    expect(presentation.activityLabel).toBe("Processando");
    expect(presentation.description).toContain("Bloqueado");
    expect(presentation.description).toContain("Processando");
  });
});
