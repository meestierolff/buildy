import { Link } from "@/lib/router";
import BrandLogo from "@/components/BrandLogo";

const Footer = ({
  feedbackEnabled = true,
  publicDemo = false,
}: {
  feedbackEnabled?: boolean;
  publicDemo?: boolean;
}) => (
  <footer className="border-t border-[#D8CFC1] bg-[#F7F2E9]">
    <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 pb-24 pt-10 text-xs text-[#655F57] sm:px-6 md:flex-row md:items-center md:px-8 md:py-10">
      <div className="flex items-center gap-3">
        <BrandLogo href="/" imageClassName="h-8 w-8 rounded-lg shadow-xs" nativeNavigation={publicDemo} textClassName="text-base" />
        <p className="border-l border-[#D8CFC1] pl-3 leading-relaxed">
          © {new Date().getFullYear()}<br className="sm:hidden" /> Maak van je verbouwing een verhaal om te bewaren.
        </p>
      </div>
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 font-medium" aria-label="Footer navigatie">
        <Link to="/privacy" className="transition-colors hover:text-[#A94E36]">
          Privacy
        </Link>
        <Link to="/voorwaarden" className="transition-colors hover:text-[#A94E36]">
          Voorwaarden
        </Link>
        {!publicDemo || feedbackEnabled ? (
          <Link to="/support" className="transition-colors hover:text-[#A94E36]">
            {publicDemo ? "Geef feedback" : "Hulp en contact"}
          </Link>
        ) : null}
      </nav>
    </div>
  </footer>
);

export default Footer;
