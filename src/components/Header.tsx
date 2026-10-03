import BrandLogo from "@/components/BrandLogo";
import { Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useInfiniteNotifications } from "@/hooks/useEngagement";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, NavLink } from "@/lib/router";

const Header = ({ activeProjectId, updateHref: preferredUpdateHref }: { activeProjectId?: string; updateHref?: string }) => {
  const { user } = useAuth();
  const notifications = useInfiniteNotifications(Boolean(user));
  const unread = notifications.isError ? 0 : notifications.data?.pages[0]?.unreadCount ?? 0;
  const updateHref = preferredUpdateHref ?? (activeProjectId ? PRODUCT_ROUTES.projectUpdateComposer(activeProjectId) : PRODUCT_ROUTES.createUpdate);
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors ${isActive ? "bg-secondary text-primary" : "text-muted-foreground hover:text-primary"}`;

  return (
    <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:min-h-16 lg:px-8">
      <BrandLogo href={user ? PRODUCT_ROUTES.projects : PRODUCT_ROUTES.landing} imageClassName="h-8 w-8 rounded-lg shadow-none" textClassName="text-xl tracking-tight" />
      {user ? (
        <>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Hoofdnavigatie">
            <NavLink to={PRODUCT_ROUTES.projects} className={navClass}>Projecten</NavLink>
            <NavLink to={PRODUCT_ROUTES.following} className={navClass}>Tijdlijn</NavLink>
            <NavLink to={PRODUCT_ROUTES.books} className={navClass}>Bouwboeken</NavLink>
            <NavLink to={PRODUCT_ROUTES.ownProfile} className={navClass}>Profiel</NavLink>
            <Button asChild size="sm" className="ml-3 min-h-11 rounded-full bg-accent px-5 text-white hover:bg-accent/90"><Link to={updateHref}>Bouwmoment toevoegen</Link></Button>
          </nav>
          <div className="flex items-center gap-1">
            <Link to={PRODUCT_ROUTES.connections} aria-label="Bouwers zoeken" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Search className="h-5 w-5" aria-hidden="true" /></Link>
            <Link to={PRODUCT_ROUTES.notifications} aria-label={unread ? `Meldingen, ${unread} ongelezen` : "Meldingen"} className="relative flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unread > 0 ? <span aria-hidden="true" className="absolute right-1 top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
          </div>
        </>
      ) : (
        <>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex" aria-label="Hoofdnavigatie">
            <Link to="/#zo-werkt-het" className="inline-flex min-h-11 items-center hover:text-primary">Hoe werkt het</Link>
            <Link to="/#voorbeeld" className="inline-flex min-h-11 items-center hover:text-primary">Het Bouwboek</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/auth" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold">Inloggen</Link>
            <Button asChild className="min-h-11 rounded-full px-4 text-sm"><Link to="/auth">Begin gratis</Link></Button>
          </div>
        </>
      )}
    </div>
  );
};
export default Header;
