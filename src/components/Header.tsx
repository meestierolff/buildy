import BrandLogo from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, NavLink } from "@/lib/router";

type HeaderProps = {
  activeProjectId?: string;
  publicDemo?: boolean;
};

const Header = ({ activeProjectId, publicDemo = false }: HeaderProps) => {
  const { user } = useAuth();
  const storyHref = activeProjectId
    ? PRODUCT_ROUTES.project(activeProjectId)
    : PRODUCT_ROUTES.newProject;
  const updateHref = activeProjectId
    ? PRODUCT_ROUTES.projectUpdateComposer(activeProjectId)
    : PRODUCT_ROUTES.newProject;
  const photobookHref = activeProjectId
    ? PRODUCT_ROUTES.projectPhotobook(activeProjectId)
    : PRODUCT_ROUTES.newProject;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `relative inline-flex min-h-11 items-center px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none ${
      isActive
        ? "text-foreground after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:bg-accent"
        : "text-muted-foreground hover:text-foreground"
    }`;
  const quietLinkClass =
    "inline-flex min-h-11 items-center px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none";

  return (
    <div className="mx-auto flex min-h-[4.5rem] max-w-7xl flex-wrap items-center justify-between gap-x-3 px-4 text-foreground sm:px-6 md:px-8">
      <BrandLogo
        imageClassName="h-8 w-8 rounded-md shadow-none"
        nativeNavigation={publicDemo}
        textClassName="hidden min-[360px]:inline"
      />

      {publicDemo ? (
        <nav
          className="order-3 flex w-full items-center justify-center gap-3 border-t border-border/60 py-1 sm:order-none sm:w-auto sm:border-0 sm:py-0"
          aria-label="Hoofdnavigatie"
        >
          <a href="/#zo-werkt-het" className={quietLinkClass}>Hoe werkt het?</a>
          <a href="/#voorbeeld" className={quietLinkClass}>Bekijk voorbeeld</a>
        </nav>
      ) : user ? (
        <nav className="hidden items-center gap-2 lg:flex" aria-label="Hoofdnavigatie">
          <NavLink to={storyHref} end className={navLinkClass}>Mijn verbouwing</NavLink>
          <Link to={updateHref} className={quietLinkClass}>Bouwmoment toevoegen</Link>
          <NavLink to={photobookHref} end className={navLinkClass}>Bouwboek</NavLink>
          <NavLink to={PRODUCT_ROUTES.ownProfile} end className={navLinkClass}>Profiel</NavLink>
        </nav>
      ) : (
        <nav
          className="order-3 flex w-full items-center justify-center gap-3 border-t border-border/60 py-1 sm:order-none sm:w-auto sm:border-0 sm:py-0"
          aria-label="Hoofdnavigatie"
        >
          <Link to="/#zo-werkt-het" className={quietLinkClass}>Hoe werkt het</Link>
          <Link to="/#voorbeeld" className={quietLinkClass}>Bekijk voorbeeld</Link>
        </nav>
      )}

      {publicDemo ? (
        <Button asChild className="min-h-11 bg-[#A94E36] px-3 text-xs text-white hover:bg-[#8F3F2C] sm:px-4 sm:text-sm">
          <a href="/#probeer-buildy">Probeer met je bouwfoto</a>
        </Button>
      ) : !user ? (
        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            to="/auth"
            className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-foreground underline decoration-[#D8CFC1] underline-offset-4 transition-colors hover:decoration-[#A94E36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm"
          >
            Inloggen
          </Link>
          <Button asChild className="min-h-11 bg-[#A94E36] px-3 text-xs text-white hover:bg-[#8F3F2C] sm:px-4 sm:text-sm">
            <Link to="/auth">Start je verbouwverhaal</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default Header;
