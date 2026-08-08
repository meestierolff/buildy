import { Link, NavLink, useLocation } from "@/lib/router";
import { useAuth } from "@/hooks/useAuth";
import { useOwnProfile } from "@/hooks/useProfiles";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import BrandLogo from "@/components/BrandLogo";
import { Plus, LogOut, User, Settings } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import BetaBadge from "@/components/BetaBadge";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

const Header = () => {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const profileQuery = useOwnProfile(Boolean(user));
  const profile = profileQuery.data;

  const isAuthRoute = pathname === "/auth" || pathname === "/wachtwoord-vergeten" || pathname === "/wachtwoord-resetten";
  const isPrimaryCreateRoute = pathname === PRODUCT_ROUTES.createUpdate;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      isActive ? "text-foreground bg-secondary/80 shadow-xs" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
    }`;

  const displayName = profile?.displayName || user?.email || "";
  const initial = displayName[0]?.toUpperCase() || "?";
  const ownProfilePath = profile ? PRODUCT_ROUTES.profile(profile.slug) : PRODUCT_ROUTES.account;

  return (
    <>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 text-foreground sm:px-6 md:px-8">
        <div className="flex items-center gap-2">
          <BrandLogo imageClassName="h-8 w-8 rounded-lg shadow-xs" />
          <BetaBadge className="hidden sm:inline-flex" />
        </div>

        <nav className="hidden md:flex items-center gap-2" aria-label="Hoofdnavigatie">
          {user ? <NavLink to={PRODUCT_ROUTES.projects} end className={navLinkClass}>Projecten</NavLink> : null}
          {user ? <NavLink to={PRODUCT_ROUTES.following} className={navLinkClass}>Volgend</NavLink> : null}
          <NavLink to={PRODUCT_ROUTES.discover} end className={navLinkClass}>Ontdekken</NavLink>
          <NavLink to={PRODUCT_ROUTES.connections} className={navLinkClass} aria-label="Connecties en vrienden">Connecties</NavLink>
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <NotificationBell />
              {!isPrimaryCreateRoute && (
                <Button asChild variant="pillOutline" className="hidden h-9 px-4 sm:inline-flex shadow-xs hover:shadow-sm transition-all">
                  <Link to={PRODUCT_ROUTES.createUpdate}>
                    <Plus className="h-3.5 w-3.5" />
                    Nieuwe update
                  </Link>
                </Button>
              )}
              {!isPrimaryCreateRoute && (
                <Button asChild size="icon" variant="outline" className="h-9 w-9 rounded-full border-border sm:hidden">
                  <Link to={PRODUCT_ROUTES.createUpdate} aria-label="Nieuwe update">
                    <Plus className="h-4 w-4" />
                  </Link>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full ring-offset-background transition-transform active:scale-95" aria-label="Open accountmenu">
                    <Avatar className="h-8 w-8 border border-border/80 shadow-xs">
                      <AvatarImage src={profile?.avatar?.proxyPath || ""} alt={displayName} />
                      <AvatarFallback className="bg-accent/20 text-accent text-xs font-semibold">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 p-1.5 shadow-lg border-border/80">
                  <DropdownMenuItem asChild>
                    <Link to={ownProfilePath} className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-md">
                      <User className="h-4 w-4 text-muted-foreground" /> Profiel
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={PRODUCT_ROUTES.account} className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-md">
                      <Settings className="h-4 w-4 text-muted-foreground" /> Account
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={PRODUCT_ROUTES.newProject} className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-md">
                      <Plus className="h-4 w-4 text-muted-foreground" /> Nieuw project
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={signOut} className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-destructive focus:text-destructive cursor-pointer rounded-md">
                    <LogOut className="h-4 w-4" /> Uitloggen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button asChild variant={isAuthRoute ? "pillOutline" : "pill"} className="h-9 px-5 shadow-xs hover:shadow-md transition-all">
              <Link to={isAuthRoute ? PRODUCT_ROUTES.landing : "/auth"}>
                {isAuthRoute ? "Bekijk projecten" : "Inloggen"}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
};

export default Header;
