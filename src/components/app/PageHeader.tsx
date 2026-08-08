import type { HTMLAttributes, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/lib/router";

import { cn } from "@/lib/utils";

export interface PageHeaderBackLink {
  href: string;
  label: string;
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  backLink?: PageHeaderBackLink;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  editorial?: boolean;
  compact?: boolean;
}

const PageHeader = ({
  title,
  eyebrow,
  description,
  backLink,
  badge,
  meta,
  actions,
  titleId,
  editorial = false,
  compact = false,
  className,
  ...props
}: PageHeaderProps) => (
  <header
    className={cn(
      "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8",
      compact ? "py-5 sm:py-6" : "py-7 sm:py-9 lg:py-11",
      className,
    )}
    aria-labelledby={titleId}
    {...props}
  >
    {backLink ? (
      <Link
        to={backLink.href}
        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {backLink.label}
      </Link>
    ) : null}

    <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? (
          <div className="mb-2 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1
            id={titleId}
            className={cn(
              "min-w-0 text-balance font-sans text-3xl font-semibold leading-[1.08] tracking-[-0.035em] text-foreground sm:text-4xl",
              editorial && "font-serif font-normal tracking-[-0.02em] sm:text-5xl",
              compact && "text-2xl sm:text-3xl",
            )}
          >
            {title}
          </h1>
          {badge}
        </div>

        {description ? (
          <div className="mt-3 max-w-2xl text-pretty font-sans text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            {description}
          </div>
        ) : null}

        {meta ? <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">{meta}</div> : null}
      </div>

      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end [&_a]:min-h-11 [&_button]:min-h-11">
          {actions}
        </div>
      ) : null}
    </div>
  </header>
);

export default PageHeader;
