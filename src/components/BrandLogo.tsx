import { Link } from "@/lib/router";

import { cn } from "@/lib/utils";

export type BrandLogoVariant = "wordmark" | "compact";

export type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  textClassName?: string;
  href?: string | null;
  variant?: BrandLogoVariant;
  ariaLabel?: string;
};

const BrandLogo = ({
  className,
  imageClassName,
  textClassName,
  href = "/",
  variant = "wordmark",
  ariaLabel = "Buildy",
}: BrandLogoProps) => {
  const compact = variant === "compact";
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[0.7rem] text-foreground shadow-sm ring-1 ring-border",
          imageClassName,
        )}
      >
        <svg viewBox="0 0 48 48" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="46" height="46" rx="11" fill="hsl(var(--card))" />
          <path
            d="M12.5 23.3 24 13.7l11.5 9.6M15.8 20.6v10.1M32.2 20.6v10.1"
            stroke="currentColor"
            strokeWidth="2.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8.6 31.2c5.4-.8 10.5.7 15.4 4.4 4.9-3.7 10-5.2 15.4-4.4M24 27.2v8.4"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m17.8 27.5 4.2-4 3.3 2 5-6"
            stroke="hsl(var(--accent))"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="m27.2 19.5 3.4-.3-.3 3.4" stroke="hsl(var(--accent))" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span
        className={cn(
          "font-sans text-lg font-semibold tracking-[-0.045em] text-foreground",
          compact && "sr-only",
          textClassName,
        )}
      >
        Buildy
      </span>
    </>
  );

  return href ? (
    <Link
      to={href}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex min-h-11 items-center gap-2.5 rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      {content}
    </Link>
  ) : (
    <div
      className={cn("inline-flex items-center gap-2.5", className)}
      role={compact ? "img" : undefined}
      aria-label={compact ? ariaLabel : undefined}
    >
      {content}
    </div>
  );
};

export default BrandLogo;
