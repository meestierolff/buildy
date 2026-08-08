import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

export type AsyncStateStatus = "loading" | "empty" | "error" | "success";

export interface AsyncStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  status: AsyncStateStatus;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
  skeletonRows?: number;
  loadingLabel?: string;
}

const DEFAULT_TITLES: Record<Exclude<AsyncStateStatus, "loading">, string> = {
  empty: "Hier is nog niets te zien",
  error: "Dit ging niet goed",
  success: "Gelukt",
};

const StateIcon = ({ status }: { status: Exclude<AsyncStateStatus, "loading"> }) => {
  if (status === "error") return <AlertTriangle className="h-6 w-6" aria-hidden="true" />;
  if (status === "success") return <CheckCircle2 className="h-6 w-6" aria-hidden="true" />;
  return <Inbox className="h-6 w-6" aria-hidden="true" />;
};

const AsyncState = ({
  status,
  title,
  description,
  action,
  icon,
  children,
  compact = false,
  skeletonRows = 3,
  loadingLabel = "Inhoud laden…",
  className,
  ...props
}: AsyncStateProps) => {
  if (status === "success" && children) {
    return (
      <div className={className} {...props}>
        {children}
      </div>
    );
  }

  if (status === "loading") {
    const rows = Math.max(1, Math.min(skeletonRows, 6));

    return (
      <div
        className={cn("w-full space-y-3", compact ? "py-4" : "py-8", className)}
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label={loadingLabel}
        {...props}
      >
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className={cn(
              "h-14 animate-pulse rounded-md bg-muted motion-reduce:animate-none",
              index === rows - 1 && rows > 1 && "w-4/5",
            )}
          />
        ))}
        <span className="sr-only">{loadingLabel}</span>
      </div>
    );
  }

  const isError = status === "error";

  return (
    <div
      className={cn(
        "flex w-full flex-col items-start border-y border-border bg-card/40 text-left sm:rounded-lg sm:border",
        compact ? "gap-2 px-4 py-5" : "gap-3 px-5 py-8 sm:px-8 sm:py-10",
        className,
      )}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      {...props}
    >
      <div
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-md bg-secondary text-foreground",
          isError && "bg-destructive/10 text-destructive",
          status === "success" && "bg-accent/[0.12] text-accent",
        )}
      >
        {icon ?? <StateIcon status={status} />}
      </div>
      <div className="max-w-xl">
        <h2 className="font-sans text-lg font-semibold tracking-[-0.02em] text-foreground">
          {title ?? DEFAULT_TITLES[status]}
        </h2>
        {description ? <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap gap-2 [&_a]:min-h-11 [&_button]:min-h-11">{action}</div> : null}
    </div>
  );
};

export default AsyncState;
