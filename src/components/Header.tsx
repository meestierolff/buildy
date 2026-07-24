import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import BrandLogo from "@/components/BrandLogo";
import { Plus, LogOut, User, Heart, Compass, Users, UserCircle2, Settings } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import OnboardingDialog from "@/components/OnboardingDialog";

const Header = () => {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [profile, setProfile] = useState<{ display_name: string | null; avatar_url: string | null } | null>(null);

  const isAuthRoute = pathname === "/auth" || pathname === "/wachtwoord-vergeten" || pathname === "/wachtwoord-resetten";
  const isNewProjectRoute = pathname === "/trips/new";

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setProfile(data);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      isActive ? "text-foreground bg-secondary/80 shadow-xs" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
    }`;

  const displayName = profile?.display_name || user?.email || "";
  const initial = displayName[0]?.toUpperCase() || "?";

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-xl text-foreground transition-all">
        <div className="max-w-7xl mx-auto px-6 md:px-8 flex h-16 items-center justify-between gap-4">
        <BrandLogo imageClassName="h-8 w-8 rounded-lg shadow-xs" />

        <nav className="hidden md:flex items-center gap-2" aria-label="Hoofdnavigatie">
          <NavLink to="/" end className={navLinkClass}>Ontdekken</NavLink>
          {user && <NavLink to="/favorieten" className={navLinkClass}>Volgend</NavLink>}
          <NavLink to="/vrienden" className={navLinkClass}>Vrienden</NavLink>
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <NotificationBell />
              {!isNewProjectRoute && (
                <Button asChild variant="pillOutline" className="hidden h-9 px-4 sm:inline-flex shadow-xs hover:shadow-sm transition-all">
                  <Link to="/trips/new">
                    <Plus className="h-3.5 w-3.5" />
                    Nieuw project
                  </Link>
                </Button>
              )}
              {!isNewProjectRoute && (
                <Button asChild size="icon" variant="outline" className="h-9 w-9 rounded-full border-border sm:hidden">
                  <Link to="/trips/new" aria-label="Nieuw project">
                    <Plus className="h-4 w-4" />
                  </Link>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full ring-offset-background transition-transform active:scale-95" aria-label="Open accountmenu">
                    <Avatar className="h-8 w-8 border border-border/80 shadow-xs">
                      <AvatarImage src={profile?.avatar_url || ""} alt={displayName} />
                      <AvatarFallback className="bg-accent/20 text-accent text-xs font-semibold">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 p-1.5 shadow-lg border-border/80">
                  <DropdownMenuItem asChild>
                    <Link to={`/profile/${user.id}`} className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-md">
                      <User className="h-4 w-4 text-muted-foreground" /> Profiel
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/account" className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-md">
                      <Settings className="h-4 w-4 text-muted-foreground" /> Account
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
      {!isAuthRoute && (
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border/80 bg-background/90 backdrop-blur-xl flex pb-[env(safe-area-inset-bottom)] shadow-lg" aria-label="Mobiele navigatie">
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
                `flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  isActive ? "text-accent font-extrabold" : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {icon}
              {label}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
};

export default Header;

