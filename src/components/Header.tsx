import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Compass, Plus, LogOut, User } from "lucide-react";

const Header = () => {
  const { user, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b bg-primary/95 backdrop-blur-md text-primary-foreground">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <Compass className="h-6 w-6 text-accent transition-transform group-hover:rotate-45" />
          <span className="text-xl font-bold font-sans text-accent">TripLog</span>
        </Link>

        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <Link to="/trips/new">
                <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90">
                  <Plus className="h-4 w-4" />
                  Nieuwe Trip
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
