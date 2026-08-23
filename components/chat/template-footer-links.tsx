import { CheckCircle2Icon, LockKeyholeIcon } from "lucide-react";

export function TemplateFooterLinks() {
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 text-center text-[11px] text-muted-foreground/65 leading-4 sm:text-xs">
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle2Icon className="size-3 text-[var(--signal)]" />
        Durable conversations
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LockKeyholeIcon className="size-3 text-primary" />
        Sends require approval
      </span>
      <span>
        Powered by{" "}
        <a
          className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
          href="https://vercel.com/eve"
          rel="noreferrer"
          target="_blank"
        >
          eve
        </a>
      </span>
    </footer>
  );
}
