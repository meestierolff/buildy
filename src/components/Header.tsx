import { Link, NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Hammer, Plus, LogOut, User, Heart, Compass } from "lucide-react";

const Header = () => {
  const { user, signOut } = useAuth();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
      isActive ? "bg-primary-foreground/15 text-accent" : "text-primary-foreground/80 hover:text-accent"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b bg-primary/95 backdrop-blur-md text-primary-foreground">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="bg-accent rounded-md p-1.5 transition-transform group-hover:rotate-6">
            <Hammer className="h-4 w-4 text-accent-foreground" />
          </div>
          <span className="text-xl font-bold font-sans tracking-tight">
            Buildy
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <NavLink to="/" end className={navLinkClass}>
            <span className="inline-flex items-center gap-1.5"><Compass className="h-3.5 w-3.5" /> Ontdekken</span>
          </NavLink>
          {user && (
            <NavLink to="/favorieten" className={navLinkClass}>
              <span className="inline-flex items-center gap-1.5"><Heart className="h-3.5 w-3.5" /> Gevolgd</span>
            </NavLink>
          )}
        </nav>

        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <Link to="/trips/new">
                <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90 shadow-md shadow-accent/30">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Nieuw project</span>
                </Button>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary-foreground/10">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src="" />
                      <AvatarFallback className="bg-accent text-accent-foreground text-xs font-bold">
                        {user.email?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/profile/${user.id}`} className="flex items-center gap-2">
                      <User className="h-4 w-4" /> Profiel
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/favorieten" className="flex items-center gap-2">
                      <Heart className="h-4 w-4" /> Gevolgd
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={signOut} className="flex items-center gap-2">
                    <LogOut className="h-4 w-4" /> Uitloggen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Link to="/auth">
              <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90">Inloggen</Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Header;
