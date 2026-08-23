import {
  ArchiveIcon,
  CircleCheckIcon,
  CircleDotIcon,
  Clock3Icon,
  type LucideIcon,
  OctagonAlertIcon,
} from "lucide-react";
import type { ProcessStatus as ProcessStatusValue } from "@/lib/processes/contracts";
import { PROCESS_STATUS_LABELS as STATUS_LABELS } from "@/lib/processes/contracts";
import { cn } from "@/lib/utils";

const STATUS_PRESENTATION: Readonly<
  Record<
    ProcessStatusValue,
    { readonly icon: LucideIcon; readonly tokenClass: string }
  >
> = {
  archived: { icon: ArchiveIcon, tokenClass: "text-muted-foreground" },
  blocked: { icon: OctagonAlertIcon, tokenClass: "text-destructive" },
  completed: { icon: CircleCheckIcon, tokenClass: "text-[var(--signal)]" },
  in_progress: { icon: CircleDotIcon, tokenClass: "text-primary" },
  waiting: {
    icon: Clock3Icon,
    tokenClass: "text-amber-600 dark:text-amber-400",
  },
};

export function getProcessStatusPresentation(
  status: ProcessStatusValue,
  isProcessing: boolean
) {
  const label = STATUS_LABELS[status];
  const activityLabel = isProcessing ? "Processando" : null;
  return {
    ...STATUS_PRESENTATION[status],
    activityLabel,
    description: activityLabel ? `${label}. ${activityLabel}.` : `${label}.`,
    label,
  };
}

export function ProcessStatus({
  className,
  compact = false,
  isProcessing,
  status,
}: {
  readonly className?: string;
  readonly compact?: boolean;
  readonly isProcessing: boolean;
  readonly status: ProcessStatusValue;
}) {
  const presentation = getProcessStatusPresentation(status, isProcessing);
  const Icon = presentation.icon;
  return (
    <span
      aria-label={presentation.description}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        presentation.tokenClass,
        className
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span
        className={cn(
          "truncate font-medium",
          compact ? "text-[10px]" : "text-xs"
        )}
      >
        {presentation.label}
      </span>
      {presentation.activityLabel ? (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
          {compact ? null : presentation.activityLabel}
        </span>
      ) : null}
    </span>
  );
}
