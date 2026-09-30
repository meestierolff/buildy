import { ArrowUpRight, BookOpen, Camera, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResilientImage } from "@/components/ResilientMedia";
import AsyncState from "@/components/app/AsyncState";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useProjectDashboard } from "@/hooks/useProjectApi";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, Navigate } from "@/lib/router";

export default function Books() {
  const { user, loading } = useAuth();
  const projects = useProjectDashboard(Boolean(user));
  usePageMeta({ title: "Jouw Bouwboeken — Buildy", description: "Van ieder bouwproject automatisch een persoonlijk fotoboek.", path: PRODUCT_ROUTES.books, noIndex: true });
  if (loading) return <main className="min-h-[60vh]" />;
  if (!user) return <Navigate to={authPagePath(PRODUCT_ROUTES.books)} replace />;
  const items = Array.from(new Map((projects.data?.pages ?? []).flatMap(page => page.items).map(project => [project.id, project])).values());
  return (
    <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6 lg:py-12">
      <header className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-accent">Om te bewaren</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Jouw Bouwboeken</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Jij bouwt aan je huis. Je foto’s en verhalen bouwen vanzelf mee aan je boek.</p>
      </header>
      {projects.isPending ? <AsyncState status="loading" title="Je boekenplank laden" /> : projects.isError ? (
        <AsyncState status="error" title="Je boeken zijn even niet bereikbaar" action={<Button variant="outline" onClick={() => void projects.refetch()}>Opnieuw proberen</Button>} />
      ) : items.length === 0 ? (
        <section className="rounded-3xl border border-border bg-card px-6 py-12 text-center">
          <BookOpen className="mx-auto mb-5 h-12 w-12 text-primary" strokeWidth={1.25} aria-hidden="true" />
          <h2 className="text-xl font-semibold">Het begint met één foto.</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Start een project en leg je eerste Bouwmoment vast. Je digitale Bouwboek ontstaat automatisch.</p>
          <Button asChild className="mt-6 min-h-11 rounded-full"><Link to={PRODUCT_ROUTES.newProject}><Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Begin je verhaal</Link></Button>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-8 min-[440px]:grid-cols-2 lg:grid-cols-3">
          {items.map(project => (
            <Link key={project.id} to={PRODUCT_ROUTES.projectPhotobook(project.id)} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
              <div className="rounded-3xl bg-secondary px-10 pb-8 pt-7">
                <div className="relative mx-auto aspect-[4/5] max-w-64 overflow-hidden rounded-r-xl bg-primary shadow-[8px_12px_24px_rgba(21,43,50,0.18)] transition-transform group-hover:-translate-y-1 motion-reduce:transform-none">
                  {project.cover && !project.cover.contentType?.startsWith("video/") ? <ResilientImage src={project.cover.proxyPath} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Camera className="absolute left-1/2 top-1/3 h-10 w-10 -translate-x-1/2 text-white/35" aria-hidden="true" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-transparent" />
                  <div className="absolute inset-y-0 left-0 w-3 border-r border-white/15 bg-black/15" />
                  <div className="absolute inset-x-5 bottom-7 text-center text-white"><p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.2em]">Ons bouwverhaal</p><h2 className="break-words font-serif text-3xl leading-none">{project.title}</h2></div>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 px-1 pt-4"><div><h3 className="font-semibold">{project.title}</h3><p className="mt-1 text-xs text-muted-foreground">{project.updateCount} Bouwmomenten · digitaal boek</p></div><ArrowUpRight className="mt-1 h-5 w-5 text-primary" aria-hidden="true" /></div>
            </Link>
          ))}
        </div>
      )}
      {projects.hasNextPage ? <Button className="mt-8 min-h-11" variant="outline" disabled={projects.isFetchingNextPage} onClick={() => void projects.fetchNextPage()}>Meer boeken laden</Button> : null}
    </main>
  );
}
