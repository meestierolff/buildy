import type { ReactNode } from "react";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Link } from "@/lib/router";

interface Props {
  title: string;
  description: string;
  updated: string;
  children: ReactNode;
}

const LegalLayout = ({ title, description, updated, children }: Props) => {
  usePageMeta({ title: `${title} · Buildy`, description });
  return (
    <main>
      <article className="max-w-3xl mx-auto px-6 md:px-8 py-12">
        <header className="mb-10 border-b border-border pb-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Juridisch
          </p>
          <h1 className="text-3xl md:text-4xl font-serif font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground mt-2">Laatst bijgewerkt: {updated}</p>
        </header>
        <div className="prose prose-sm md:prose-base max-w-none prose-headings:font-serif prose-headings:font-semibold prose-h2:mt-10 prose-h2:mb-3 prose-h2:text-xl prose-p:leading-relaxed prose-li:my-1 prose-a:text-foreground prose-a:underline prose-a:underline-offset-2 prose-th:text-left prose-th:align-top prose-td:align-top">
          {children}
        </div>
        <nav aria-label="Juridische pagina's" className="mt-12 pt-6 border-t border-border flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <Link to="/voorwaarden" className="hover:text-foreground">Algemene voorwaarden</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacyverklaring</Link>
          <Link to="/support" className="hover:text-foreground">Support</Link>
        </nav>
      </article>
    </main>
  );
};

export default LegalLayout;
