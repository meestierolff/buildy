import { Link, NavLink, useLocation } from "@/lib/router";
import { useAuth } from "@/hooks/useAuth";
import { useOwnProfile } from "@/hooks/useProfiles";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import BrandLogo from "@/components/BrandLogo";
import { Plus, LogOut, PackageCheck, User, Settings } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import BetaBadge from "@/components/BetaBadge";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

const Header = () => {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const profileQuery = useOwnProfile(Boolean(user));
  const profile = profileQuery.data;

  const isPrimaryCreateRoute = pathname === PRODUCT_ROUTES.createUpdate;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `relative inline-flex min-h-11 items-center px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none ${
      isActive ? "text-foreground after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:bg-accent" : "text-muted-foreground hover:text-foreground"
    }`;
  const publicLinkClass = "inline-flex min-h-11 items-center px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none";

  const displayName = profile?.displayName || user?.email || "";
  const initial = displayName[0]?.toUpperCase() || "?";
  const ownProfilePath = profile ? PRODUCT_ROUTES.profile(profile.slug) : PRODUCT_ROUTES.account;

  return (
    <>
      <div className="mx-auto flex min-h-[4.5rem] max-w-7xl items-center justify-between gap-2 px-4 text-foreground sm:gap-4 sm:px-6 md:px-8">
        <div className="flex items-center gap-2">
          <BrandLogo imageClassName="h-8 w-8 rounded-md shadow-none" textClassName="hidden min-[360px]:inline" />
          <BetaBadge className="hidden xl:inline-flex" />
        </div>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Hoofdnavigatie">
          {user ? (
            <>
              <NavLink to={PRODUCT_ROUTES.projects} end className={navLinkClass}>Mijn verbouwingen</NavLink>
              <NavLink to={PRODUCT_ROUTES.following} className={navLinkClass}>Volgend</NavLink>
              <NavLink to={PRODUCT_ROUTES.discover} end className={navLinkClass}>Ontdek verbouwingen</NavLink>
              <NavLink to={PRODUCT_ROUTES.connections} className={navLinkClass}>Connecties</NavLink>
            </>
          ) : (
            <>
              <Link to="/#voorbeeld" className={publicLinkClass}>Bekijk voorbeeld</Link>
              <NavLink to={PRODUCT_ROUTES.discover} end className={navLinkClass}>Ontdek verbouwingen</NavLink>
              <Link to="/#zo-werkt-het" className={publicLinkClass}>Hoe werkt het?</Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <NotificationBell />
              {!isPrimaryCreateRoute ? (
                <Button asChild variant="outline" className="hidden min-h-11 border-accent bg-transparent px-4 sm:inline-flex">
                  <Link to={PRODUCT_ROUTES.createUpdate}>
                    <Plus className="h-3.5 w-3.5" />
                    Bouwmoment toevoegen
                  </Link>
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full ring-offset-background transition-transform active:scale-95 motion-reduce:transition-none" aria-label="Open accountmenu">
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
                    <Link to={ownProfilePath} className="flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium">
                      <User className="h-4 w-4 text-muted-foreground" /> Profiel
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={PRODUCT_ROUTES.orders} className="flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium">
                      <PackageCheck className="h-4 w-4 text-muted-foreground" /> Bestellingen
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={PRODUCT_ROUTES.account} className="flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium">
                      <Settings className="h-4 w-4 text-muted-foreground" /> Account
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={PRODUCT_ROUTES.newProject} className="flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium">
                      <Plus className="h-4 w-4 text-muted-foreground" /> Nieuwe verbouwing
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={signOut} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" /> Uitloggen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Link to="/auth" className="hidden min-h-11 items-center px-2 text-sm font-medium text-foreground underline decoration-[#D8CFC1] underline-offset-4 hover:decoration-[#A94E36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline-flex">
                Inloggen
              </Link>
              <Button asChild className="min-h-11 bg-[#A94E36] px-3 text-xs text-white hover:bg-[#8F3F2C] sm:px-4 sm:text-sm">
                <Link to="/#probeer-buildy">Voeg je eerste verbouwfoto toe</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default Header;
