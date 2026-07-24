import { Link } from "react-router-dom";
import BrandLogo from "@/components/BrandLogo";

const Footer = () => (
  <footer className="mt-16 border-t border-border/80 bg-card/60 backdrop-blur-xs">
    <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 pb-24 pt-10 text-xs text-muted-foreground md:flex-row md:items-center md:px-8 md:py-10">
      <div className="flex items-center gap-3">
        <BrandLogo href="/" imageClassName="h-8 w-8 rounded-lg shadow-xs" textClassName="text-base" />
        <p className="border-l border-border/80 pl-3 leading-relaxed font-light">
          © {new Date().getFullYear()}<br className="sm:hidden" /> Van verbouwing naar Bouwboek.
        </p>
      </div>
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 font-medium" aria-label="Footer navigatie">
        <a
          href="https://www.instagram.com/buildy.log/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-accent transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
          Instagram
          <span className="sr-only"> (opent in een nieuw venster)</span>
        </a>
        <Link to="/voorwaarden" className="hover:text-accent transition-colors">
          Algemene voorwaarden
        </Link>
        <Link to="/privacy" className="hover:text-accent transition-colors">
          Privacy
        </Link>
        <Link to="/herroeping" className="hover:text-accent transition-colors">
          Herroepingsrecht
        </Link>
      </nav>
    </div>
  </footer>
);

export default Footer;

