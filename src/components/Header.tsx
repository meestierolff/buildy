import { Link, NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, LogOut, User, Heart, Compass, Users, UserCircle2 } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import OnboardingDialog from "@/components/OnboardingDialog";

const Header = () => {
  const { user, signOut } = useAuth();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-[11px] font-bold uppercase tracking-[0.2em] py-2 transition-colors ${
      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md text-foreground">
      <div className="max-w-7xl mx-auto px-6 md:px-8 flex h-16 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 bg-foreground rounded-md flex items-center justify-center">
            <svg className="w-4 h-4 text-background" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">Buildy</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          <NavLink to="/" end className={navLinkClass}>Ontdekken</NavLink>
          {user && <NavLink to="/favorieten" className={navLinkClass}>Gevolgd</NavLink>}
          <NavLink to="/vrienden" className={navLinkClass}>Vrienden</NavLink>
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <NotificationBell />
              <Link to="/trips/new" className="hidden sm:block">
                <Button size="sm" variant="outline" className="rounded-full px-4 text-[11px] font-bold uppercase tracking-widest gap-1.5 border-border">
                  <Plus className="h-3.5 w-3.5" />
                  Nieuw project
                </Button>
              </Link>
              <Link to="/trips/new" className="sm:hidden">
                <Button size="icon" variant="outline" className="rounded-full h-9 w-9 border-border">
                  <Plus className="h-4 w-4" />
                </Button>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src="" />
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
                  <DropdownMenuItem onClick={signOut} className="flex items-center gap-2 cursor-pointer">
                    <LogOut className="h-4 w-4" /> Uitloggen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Link to="/auth">
              <Button size="sm" className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest bg-foreground text-background hover:bg-foreground/90">
                Inloggen
              </Button>
            </Link>
          )}
        </div>
      </div>
      {user && <OnboardingDialog />}

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background/95 backdrop-blur-md flex">
        {[
          { to: "/", end: true, icon: <Compass className="h-5 w-5" />, label: "Ontdekken" },
          ...(user ? [{ to: "/favorieten", end: false, icon: <Heart className="h-5 w-5" />, label: "Gevolgd" }] : []),
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
      </nav>
    </header>
  );
};

export default Header;
