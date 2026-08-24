import { Link } from "@/lib/router";
import BrandLogo from "@/components/BrandLogo";

const Footer = () => (
  <div className="mt-16 border-t border-border/80 bg-card/60 backdrop-blur-xs">
    <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 pb-24 pt-10 text-xs text-muted-foreground md:flex-row md:items-center md:px-8 md:py-10">
      <div className="flex items-center gap-3">
        <BrandLogo href="/" imageClassName="h-8 w-8 rounded-lg shadow-xs" textClassName="text-base" />
        <p className="border-l border-border/80 pl-3 leading-relaxed font-light">
          © {new Date().getFullYear()}<br className="sm:hidden" /> Van verbouwing naar Bouwboek.
        </p>
      </div>
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 font-medium" aria-label="Footer navigatie">
        <Link to="/voorwaarden" className="hover:text-accent transition-colors">
          Algemene voorwaarden
        </Link>
        <Link to="/privacy" className="hover:text-accent transition-colors">
          Privacy
        </Link>
        <Link to="/herroeping" className="hover:text-accent transition-colors">
          Herroepingsrecht
        </Link>
        <Link to="/contentbeleid" className="hover:text-accent transition-colors">
          Contentbeleid
        </Link>
        <Link to="/huisregels" className="hover:text-accent transition-colors">
          Huisregels
        </Link>
        <Link to="/support" className="hover:text-accent transition-colors">
          Support
        </Link>
        <Link to="/melden" className="hover:text-accent transition-colors">
          Melden
        </Link>
      </nav>
    </div>
  </div>
);

export default Footer;
