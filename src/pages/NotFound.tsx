import { Link, useLocation } from "@/lib/router";
import { usePageMeta } from "@/hooks/usePageMeta";

const NotFound = () => {
  const location = useLocation();
  usePageMeta({
    title: "Pagina niet gevonden — Buildy",
    description: "Deze Buildy-pagina bestaat niet of is verplaatst.",
    path: location.pathname,
    noIndex: true,
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center">
        <p className="eyebrow mb-3">404</p>
        <h1 className="mb-4 font-serif italic text-4xl md:text-5xl">Pagina niet gevonden.</h1>
        <p className="mb-8 text-sm text-muted-foreground">Deze pagina bestaat niet of is verplaatst.</p>
        <Link to="/" className="text-[11px] font-bold uppercase tracking-widest underline underline-offset-4 hover:text-accent">
          Terug naar Buildy
        </Link>
      </div>
    </main>
  );
};

export default NotFound;
