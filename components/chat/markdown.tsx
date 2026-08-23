"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

const streamdownPlugins = { cjk, code, math, mermaid };

export type MarkdownProps = ComponentProps<typeof Streamdown>;

const markdownComponents: MarkdownProps["components"] = {
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground",
        className
      )}
      rel="noreferrer"
      target="_blank"
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "mx-3 border-border border-l-2 pl-3 text-[15px] text-muted-foreground leading-6",
        className
      )}
      {...props}
    />
  ),
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "mt-7 mb-4 px-3 font-medium text-xl leading-7 tracking-normal",
        className
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "mt-6 mb-3 px-3 font-medium text-base leading-6 tracking-normal",
        className
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "mt-5 mb-2 px-3 font-medium text-sm leading-6 tracking-normal",
        className
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "mt-4 mb-2 px-3 font-medium text-sm leading-6 tracking-normal",
        className
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "mt-4 mb-2 px-3 font-medium text-xs leading-5 tracking-normal",
        className
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "mt-4 mb-2 px-3 font-medium text-muted-foreground text-xs leading-5 tracking-normal",
        className
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("mx-3 my-4 border-border/70", className)} {...props} />
  ),
  inlineCode: ({ className, ...props }) => (
    <code
      className={cn(
        "rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[0.92em] text-foreground",
        className
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li
      className={cn("pl-1 text-[15px] text-foreground leading-6", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "flex list-decimal flex-col gap-1.5 px-3 pl-8 text-[15px] text-foreground leading-6",
        className
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn("px-3 text-[15px] text-foreground leading-6", className)}
      {...props}
    />
  ),
  strong: ({ className, ...props }) => (
    <strong
      className={cn("font-medium text-foreground", className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "flex list-disc flex-col gap-1.5 px-3 pl-8 text-[15px] text-foreground leading-6",
        className
      )}
      {...props}
    />
  ),
};

export const Markdown = memo(function Markdown({
  className,
  ...props
}: MarkdownProps) {
  return (
    <Streamdown
      className={cn(
        "min-w-0 text-[15px] leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      components={markdownComponents}
      plugins={streamdownPlugins}
      {...props}
    />
  );
});
