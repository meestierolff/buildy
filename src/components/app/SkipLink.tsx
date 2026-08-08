import type { AnchorHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export interface SkipLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  targetId?: string;
  label?: string;
}

const SkipLink = ({
  targetId = "main-content",
  label = "Ga naar de hoofdinhoud",
  className,
  ...props
}: SkipLinkProps) => (
  <a
    href={`#${targetId}`}
    className={cn(
      "fixed left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[100] -translate-y-24 rounded-md bg-foreground px-4 py-3 text-sm font-semibold text-background shadow-lg",
      "transition-transform duration-150 focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
      "motion-reduce:transition-none",
      className,
    )}
    {...props}
  >
    {label}
  </a>
);

export default SkipLink;
