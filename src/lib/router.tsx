import {
  Router,
  Route as WouterRoute,
  Switch,
  Link as WouterLink,
  Redirect,
  useLocation as useWouterLocation,
  useParams as useWouterParams,
  useSearchParams,
} from "wouter";
import {
  forwardRef,
  useMemo,
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

type NavigationOptions = { replace?: boolean; state?: unknown };

export function normalizeAppPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("Buildy-navigatie accepteert alleen veilige absolute app-paden.");
  }

  return value;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  replace?: boolean;
  state?: unknown;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ to, replace, state, ...props }, ref) => (
    <WouterLink ref={ref} to={normalizeAppPath(to)} replace={replace} state={state} {...props} />
  ),
);
Link.displayName = "Link";

export type NavLinkState = { isActive: boolean; isPending: false };

export interface NavLinkProps extends Omit<LinkProps, "children" | "className"> {
  end?: boolean;
  className?: string | ((state: NavLinkState) => string | undefined);
  children?: ReactNode | ((state: NavLinkState) => ReactNode);
}

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ to, end = false, className, children, "aria-current": ariaCurrent, ...props }, ref) => {
    const { pathname } = useLocation();
    const targetPath = normalizeAppPath(to).split(/[?#]/, 1)[0] || "/";
    const isActive = end
      ? pathname === targetPath
      : pathname === targetPath || (targetPath !== "/" && pathname.startsWith(`${targetPath}/`));
    const state: NavLinkState = { isActive, isPending: false };

    return (
      <Link
        ref={ref}
        to={to}
        className={typeof className === "function" ? className(state) : className}
        aria-current={ariaCurrent ?? (isActive ? "page" : undefined)}
        {...props}
      >
        {typeof children === "function" ? children(state) : children}
      </Link>
    );
  },
);
NavLink.displayName = "NavLink";

export function BrowserRouter({ children }: { children: ReactNode; future?: unknown }): ReactElement {
  return <Router>{children}</Router>;
}

export const Routes = Switch;

export function Route({ path, element }: { path: string; element: ReactNode }): ReactElement {
  return path === "*"
    ? <WouterRoute>{element}</WouterRoute>
    : <WouterRoute path={path}>{element}</WouterRoute>;
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }): ReactElement {
  return <Redirect to={normalizeAppPath(to)} replace={replace} />;
}

export function useNavigate(): (to: string, options?: NavigationOptions) => void {
  const [, navigate] = useWouterLocation();
  return (to, options) => navigate(normalizeAppPath(to), options);
}

export function useLocation(): {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
} {
  const [pathname] = useWouterLocation();

  return useMemo(
    () => ({
      pathname,
      search: typeof window === "undefined" ? "" : window.location.search,
      hash: typeof window === "undefined" ? "" : window.location.hash,
      state: typeof window === "undefined" ? undefined : window.history.state,
    }),
    [pathname],
  );
}

export function useParams<TParams extends Record<string, string | undefined> = Record<string, string | undefined>>() {
  return useWouterParams<TParams>();
}

export { useSearchParams };
