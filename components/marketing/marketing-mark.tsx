import { cn } from "@/lib/utils";

export function MarketingMark({ className }: { readonly className?: string }) {
  return (
    <span
      aria-label="Marketing Room"
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-xl bg-primary font-semibold text-[11px] text-primary-foreground tracking-[-0.04em] shadow-[0_8px_24px_-12px_var(--primary)]",
        className
      )}
    >
      M/5
    </span>
  );
}
