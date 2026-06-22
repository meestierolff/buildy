import { Link } from "react-router-dom";

const Footer = () => (
  <footer className="border-t border-border bg-background/60 mt-12">
    <div className="max-w-7xl mx-auto px-6 md:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
      <p>© {new Date().getFullYear()} Buildy — Documenteer je verbouwing.</p>
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
