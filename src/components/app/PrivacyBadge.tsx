import type { HTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Clock3, Globe2, LockKeyhole, Users } from "lucide-react";

import { cn } from "@/lib/utils";

export type PrivacyBadgeLevel = "private" | "public" | "shared" | "pending";

interface PrivacyBadgeConfig {
  label: string;
  description: string;
  icon: LucideIcon;
  className: string;
}

const PRIVACY_BADGE_CONFIG: Record<PrivacyBadgeLevel, PrivacyBadgeConfig> = {
  private: {
    label: "Privé",
    description: "Alleen zichtbaar voor jou",
    icon: LockKeyhole,
    className: "border-foreground/[0.15] bg-secondary text-secondary-foreground",
  },
  public: {
    label: "Openbaar",
    description: "Zichtbaar voor iedereen",
    icon: Globe2,
    className: "border-accent/30 bg-accent/10 text-foreground",
  },
  shared: {
    label: "Gedeeld",
    description: "Zichtbaar voor het gekozen publiek",
    icon: Users,
    className: "border-blue-300/60 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100",
  },
  pending: {
    label: "Verzoek in behandeling",
    description: "De eigenaar heeft nog niet gereageerd",
    icon: Clock3,
    className: "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  },
};

export interface PrivacyBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  level: PrivacyBadgeLevel;
  label?: string;
  compact?: boolean;
}

const PrivacyBadge = ({ level, label, compact = false, className, ...props }: PrivacyBadgeProps) => {
  const config = PRIVACY_BADGE_CONFIG[level];
  const Icon = config.icon;
  const visibleLabel = label ?? config.label;

  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 font-sans text-xs font-semibold leading-none",
        config.className,
        compact && "h-8 w-8 justify-center px-0",
        className,
      )}
      aria-label={`${visibleLabel}. ${config.description}`}
      {...props}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className={cn(compact && "sr-only")}>{visibleLabel}</span>
    </span>
  );
};

export default PrivacyBadge;
