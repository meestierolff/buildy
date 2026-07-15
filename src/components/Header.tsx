import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import BrandLogo from "@/components/BrandLogo";
import { Plus, LogOut, User, Heart, Compass, Users, UserCircle2, Settings } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import OnboardingDialog from "@/components/OnboardingDialog";

const Header = () => {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const isAuthRoute = pathname === "/auth" || pathname === "/wachtwoord-vergeten" || pathname === "/wachtwoord-resetten";
  const isNewProjectRoute = pathname === "/trips/new";

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-sm px-1 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 ${
      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md text-foreground">
        <div className="max-w-7xl mx-auto px-6 md:px-8 flex h-16 items-center justify-between gap-4">
        <BrandLogo imageClassName="h-8 w-8 rounded-lg" />

        <nav className="hidden md:flex items-center gap-8" aria-label="Hoofdnavigatie">
          <NavLink to="/" end className={navLinkClass}>Ontdekken</NavLink>
          {user && <NavLink to="/favorieten" className={navLinkClass}>Volgend</NavLink>}
          <NavLink to="/vrienden" className={navLinkClass}>Vrienden</NavLink>
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <NotificationBell />
              {!isNewProjectRoute && <Button asChild variant="pillOutline" className="hidden h-9 px-4 sm:inline-flex">
                <Link to="/trips/new">
                  <Plus className="h-3.5 w-3.5" />
                  Nieuw project
                </Link>
              </Button>}
              {!isNewProjectRoute && <Button asChild size="icon" variant="outline" className="h-9 w-9 rounded-full border-border sm:hidden">
                <Link to="/trips/new" aria-label="Nieuw project">
                  <Plus className="h-4 w-4" />
                </Link>
              </Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full" aria-label="Open accountmenu">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src="" alt="" />
                      <AvatarFallback className="bg-muted text-foreground text-xs font-semibold">
                        {user.email?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link to={`/profile/${user.id}`} className="flex items-center gap-2 cursor-pointer">
                      <User className="h-4 w-4" /> Profiel
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/account" className="flex items-center gap-2 cursor-pointer">
                      <Settings className="h-4 w-4" /> Account
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={signOut} className="flex items-center gap-2 cursor-pointer">
                    <LogOut className="h-4 w-4" /> Uitloggen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button asChild variant={isAuthRoute ? "pillOutline" : "pill"} className="h-9 px-5">
              <Link to={isAuthRoute ? "/" : "/auth"}>
                {isAuthRoute ? "Bekijk projecten" : "Inloggen"}
              </Link>
            </Button>
          )}
        </div>
        </div>
      </header>
      {user && <OnboardingDialog />}

      {/* Mobile bottom tab bar */}
      {!isAuthRoute && <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background/95 backdrop-blur-md flex pb-[env(safe-area-inset-bottom)]" aria-label="Mobiele navigatie">
        {[
          { to: "/", end: true, icon: <Compass className="h-5 w-5" />, label: "Ontdekken" },
          ...(user ? [{ to: "/favorieten", end: false, icon: <Heart className="h-5 w-5" />, label: "Volgend" }] : []),
          { to: "/vrienden", end: false, icon: <Users className="h-5 w-5" />, label: "Vrienden" },
          ...(user ? [{ to: `/profile/${user.id}`, end: false, icon: <UserCircle2 className="h-5 w-5" />, label: "Profiel" }] : []),
        ].map(({ to, end, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }: { isActive: boolean }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                isActive ? "text-foreground" : "text-muted-foreground"
              }`
            }
          >
            {icon}
            {label}
          </NavLink>
        ))}
      </nav>}
    </>
  );
};

export default Header;
