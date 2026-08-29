"use client";

import {
  ArrowUpIcon,
  Loader2Icon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ATTACHMENT_INPUT_ACCEPT,
  type ComposerAttachment,
  formatAttachmentSize,
  getAttachmentRejection,
  isPreviewableImage,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/chat/attachments";
import {
  getChatMessageLength,
  MAX_CHAT_MESSAGE_CHARS,
} from "@/lib/chat/limits";
import { cn } from "@/lib/utils";

export function ChatComposer({
  attachments = [],
  autoFocus = true,
  className,
  disabled = false,
  disabledReason,
  footerStart,
  isBusy = false,
  isPreparing = false,
  maxLength = MAX_CHAT_MESSAGE_CHARS,
  onAttachmentError,
  onAttachmentsChange,
  onChange,
  onSubmit,
  placeholder = "Brief the marketing team...",
  value,
}: {
  readonly attachments?: readonly ComposerAttachment[];
  readonly autoFocus?: boolean;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly footerStart?: ReactNode;
  readonly isBusy?: boolean;
  readonly isPreparing?: boolean;
  readonly maxLength?: number;
  readonly onAttachmentError?: (message: string) => void;
  readonly onAttachmentsChange?: (
    attachments: readonly ComposerAttachment[]
  ) => void;
  readonly onChange: (value: string) => void;
  readonly onStop: () => void;
  readonly onSubmit: (
    value: string,
    attachments: readonly ComposerAttachment[]
  ) => void | Promise<void>;
  readonly placeholder?: string;
  readonly value: string;
}) {
  const composerId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaDisabled = disabled || isBusy || isPreparing;
  const trimmedValue = value.trim();
  const isOverMaxLength = getChatMessageLength(trimmedValue) > maxLength;
  const canAttach = Boolean(onAttachmentsChange) && !textareaDisabled;

  useEffect(() => {
    if (!autoFocus || textareaDisabled) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, textareaDisabled]);

  const submitValue = useCallback(() => {
    const text = value.trim();
    if (
      !text ||
      disabled ||
      isBusy ||
      isPreparing ||
      getChatMessageLength(text) > maxLength
    ) {
      return;
    }

    void onSubmit(text, attachments);
  }, [attachments, disabled, isBusy, isPreparing, maxLength, onSubmit, value]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submitValue();
    },
    [submitValue]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitValue();
      }
    },
    [submitValue]
  );

  const handleFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const picked = [...(input.files ?? [])];
      input.value = "";

      if (!(picked.length && onAttachmentsChange)) {
        return;
      }

      const staged = [...attachments];

      for (const file of picked) {
        const mediaType = file.type || "";
        const rejection = getAttachmentRejection({
          mediaType,
          name: file.name,
          size: file.size,
          stagedBytes: staged.reduce((total, item) => total + item.size, 0),
          stagedCount: staged.length,
        });

        if (rejection) {
          onAttachmentError?.(rejection);
          break;
        }

        staged.push({
          dataUrl: await readFileAsDataUrl(file),
          id: `${file.name}:${file.size}:${file.lastModified}`,
          mediaType,
          name: file.name,
          size: file.size,
        });
      }

      onAttachmentsChange(staged);
      textareaRef.current?.focus({ preventScroll: true });
    },
    [attachments, onAttachmentError, onAttachmentsChange]
  );

  const removeAttachment = useCallback(
    (id: string) => {
      onAttachmentsChange?.(attachments.filter((item) => item.id !== id));
    },
    [attachments, onAttachmentsChange]
  );

  const form = (
    <form
      className={cn(
        "min-w-0 rounded-[14px] border border-border/80 bg-card/95 shadow-sm transition-colors focus-within:border-border focus-within:ring-[1px] focus-within:ring-foreground/5 dark:bg-muted/45 dark:focus-within:ring-white/5",
        className
      )}
      data-chat-composer
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor={composerId}>
        Message the marketing team
      </label>
      {attachments.length ? (
        <ul className="flex flex-wrap gap-1.5 px-3 pt-3 sm:px-4">
          {attachments.map((attachment) => (
            <AttachmentChip
              attachment={attachment}
              key={attachment.id}
              onRemove={canAttach ? removeAttachment : undefined}
            />
          ))}
        </ul>
      ) : null}
      <textarea
        autoFocus={autoFocus}
        className="max-h-32 min-h-12 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-base leading-6 outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 md:text-[15px] dark:placeholder:text-muted-foreground/60"
        data-chat-composer-input
        disabled={textareaDisabled}
        id={composerId}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={2}
        value={value}
      />
      <div className="flex min-h-9 items-center justify-between gap-2 px-3 pt-1 pb-2 sm:gap-3 sm:px-4">
        <div className="-ml-2 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {onAttachmentsChange ? (
            <>
              <input
                accept={ATTACHMENT_INPUT_ACCEPT}
                className="hidden"
                multiple
                onChange={(event) => void handleFilesSelected(event)}
                ref={fileInputRef}
                type="file"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Attach files"
                    className="size-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
                    disabled={!canAttach}
                    onClick={() => fileInputRef.current?.click()}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Attach files, up to {MAX_ATTACHMENTS_PER_MESSAGE}
                </TooltipContent>
              </Tooltip>
            </>
          ) : null}
          {footerStart ?? <span className="block h-8" />}
        </div>
        <div className="flex shrink-0 items-center">
          {isBusy ? (
            <Button
              aria-label="Response in progress"
              className="size-6 cursor-default rounded-md bg-foreground/15 text-foreground/55 shadow-none hover:bg-foreground/15 disabled:pointer-events-auto disabled:cursor-default disabled:opacity-100"
              disabled
              size="icon-xs"
              type="button"
            >
              <SquareIcon className="size-2.5 fill-current" />
            </Button>
          ) : isPreparing ? (
            <Button
              aria-label="Preparing chat"
              className="size-6 rounded-md bg-foreground/75 text-background"
              disabled
              size="icon-xs"
              type="button"
            >
              <Loader2Icon className="size-3 animate-spin" />
            </Button>
          ) : (
            <Button
              aria-label="Send message"
              className="size-6 cursor-pointer rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-30"
              disabled={
                disabled || trimmedValue.length === 0 || isOverMaxLength
              }
              size="icon-xs"
              type="submit"
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );

  if (!(disabledReason && (disabled || isBusy || isPreparing))) {
    return form;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div aria-label={disabledReason} className="min-w-0">
          {form}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  readonly attachment: ComposerAttachment;
  readonly onRemove?: (id: string) => void;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/70 py-1 pr-1 pl-1.5">
      {isPreviewableImage(attachment.mediaType) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="size-6 shrink-0 rounded object-cover"
          height={24}
          src={attachment.dataUrl}
          width={24}
        />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted/70 text-muted-foreground">
          <PaperclipIcon className="size-3" />
        </span>
      )}
      <span className="max-w-40 truncate text-[12px] leading-5">
        {attachment.name}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatAttachmentSize(attachment.size)}
      </span>
      {onRemove ? (
        <Button
          aria-label={`Remove ${attachment.name}`}
          className="size-5 shrink-0 rounded text-muted-foreground hover:text-foreground"
          onClick={() => onRemove(attachment.id)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <XIcon className="size-3" />
        </Button>
      ) : null}
    </li>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
