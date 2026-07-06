import { Link } from "react-router-dom";
import BrandLogo from "@/components/BrandLogo";

const Footer = () => (
  <footer className="border-t border-border bg-background/60 mt-12">
    <div className="max-w-7xl mx-auto px-6 md:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <BrandLogo href="/" imageClassName="h-8 w-8 rounded-lg" textClassName="text-base" />
        <p>© {new Date().getFullYear()} — Documenteer je verbouwing.</p>
      </div>
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <a
          href="https://www.instagram.com/buildy.log/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
          Instagram
        </a>
        <Link to="/voorwaarden" className="hover:text-foreground transition-colors">
          Algemene voorwaarden
        </Link>
        <Link to="/privacy" className="hover:text-foreground transition-colors">
          Privacy
        </Link>
        <Link to="/herroeping" className="hover:text-foreground transition-colors">
          Herroepingsrecht
        </Link>
      </nav>
    </div>
  </footer>
);

export default Footer;
