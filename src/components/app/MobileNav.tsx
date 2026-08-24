import type { ComponentPropsWithoutRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Compass,
  FolderOpen,
  Heart,
  MessageSquareText,
  PackageCheck,
  Plus,
  Settings,
  UserCircle2,
  Users,
} from "lucide-react";
import { NavLink } from "@/lib/router";

import { cn } from "@/lib/utils";
import {
  getMobileNavigationItems,
  type ProductNavigationIcon,
  type ProductNavigationItem,
} from "@/lib/productNavigation";

const NAVIGATION_ICONS: Record<ProductNavigationIcon, LucideIcon> = {
  projects: FolderOpen,
  following: Heart,
  add: Plus,
  discover: Compass,
  profile: UserCircle2,
  connections: Users,
  notifications: Bell,
  orders: PackageCheck,
  account: Settings,
  feedback: MessageSquareText,
};

const PRODUCT_LABELS: Readonly<Record<string, string>> = {
  projects: "Verbouwingen",
  update: "Bouwmoment",
  discover: "Verhalen",
  connections: "Connecties",
};

export interface MobileNavProps extends Omit<ComponentPropsWithoutRef<"nav">, "children"> {
  items?: readonly ProductNavigationItem[];
  profileHref?: string;
  updateHref?: string;
  label?: string;
}

const MobileNav = ({
  items,
  profileHref,
  updateHref,
  label = "Primaire navigatie",
  className,
  ...props
}: MobileNavProps) => {
  const navigationItems = items ?? getMobileNavigationItems({ profileHref, updateHref });

  return (
    <nav
      aria-label={label}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 border-t border-border/90 bg-background/95 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] shadow-[0_-8px_24px_hsl(var(--foreground)/0.06)] backdrop-blur supports-[backdrop-filter]:bg-background/[0.88] lg:hidden",
        className,
      )}
      {...props}
    >
      <ul className="mx-auto flex max-w-lg items-stretch px-1" role="list">
        {navigationItems.map((item) => {
          const Icon = NAVIGATION_ICONS[item.icon];
          const label = PRODUCT_LABELS[item.id] ?? item.label;

          return (
            <li key={item.id} className="min-w-0 flex-1">
              <NavLink
                to={item.href}
                end={item.exact}
                className={({ isActive }) =>
                  cn(
                    "group relative flex min-h-[4.25rem] touch-manipulation flex-col items-center justify-center gap-1 px-1 pb-1 pt-2 text-center text-[10px] font-semibold leading-tight text-muted-foreground",
                    "transition-colors duration-150 hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                    isActive && !item.primaryAction && "text-foreground",
                    item.primaryAction && "text-foreground",
                  )
                }
                aria-label={label}
              >
                {({ isActive }) => (
                  <>
                    {!item.primaryAction ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-x-1/2 top-0 h-0.5 w-6 -translate-x-1/2 bg-transparent",
                          isActive && "bg-accent",
                        )}
                      />
                    ) : null}

                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md",
                        item.primaryAction &&
                          "-mt-6 h-14 w-14 rounded-full bg-accent text-accent-foreground shadow-[0_6px_18px_hsl(var(--foreground)/0.16)] ring-4 ring-background transition-transform duration-150 group-active:scale-95 motion-reduce:transition-none",
                        isActive && !item.primaryAction && "bg-accent/[0.12] text-accent",
                      )}
                    >
                      <Icon className={cn("h-5 w-5", item.primaryAction && "h-6 w-6")} strokeWidth={2} />
                    </span>

                    <span className={cn(item.primaryAction && "font-bold text-foreground")}>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileNav;
