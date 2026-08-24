import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";
import SkipLink from "@/components/app/SkipLink";

export interface AppShellProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  mobileNavigation?: ReactNode;
  mainId?: string;
  mainClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  skipLinkLabel?: string;
  stickyHeader?: boolean;
}

const AppShell = ({
  children,
  header,
  footer,
  mobileNavigation,
  mainId = "main-content",
  mainClassName,
  headerClassName,
  footerClassName,
  skipLinkLabel,
  stickyHeader = true,
  className,
  ...props
}: AppShellProps) => (
  <div
    className={cn("flex min-h-[100dvh] min-w-0 flex-col bg-background font-sans text-foreground", className)}
    data-app-shell=""
    {...props}
  >
    <SkipLink targetId={mainId} label={skipLinkLabel} />

    {header ? (
      <header
        className={cn(
          "z-40 border-b border-border/80 bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/[0.85]",
          stickyHeader && "sticky top-0",
          headerClassName,
        )}
      >
        {header}
      </header>
    ) : null}

    <main
      id={mainId}
      tabIndex={-1}
      className={cn(
        "min-w-0 flex-1 scroll-mt-24 focus:outline-none",
        mobileNavigation && "pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0",
        mainClassName,
      )}
    >
      {children}
    </main>

    {footer ? (
      <footer className={cn(mobileNavigation && "mb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:mb-0", footerClassName)}>
        {footer}
      </footer>
    ) : null}

    {mobileNavigation}
  </div>
);

export default AppShell;
