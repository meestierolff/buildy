import { ArrowRight, BookOpen, Camera, Check, Plus, ShieldCheck, Users } from "lucide-react";
import AsyncState from "@/components/app/AsyncState";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import ProjectCard from "@/components/ProjectCard";
import LocalPhotoDemo, { LOCAL_PHOTO_AUTH_PATH } from "@/components/landing/LocalPhotoDemo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useProjectDashboard } from "@/hooks/useProjectApi";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, Navigate, useLocation } from "@/lib/router";

const Index = () => {
  const { user, loading: authLoading } = useAuth();
  const { pathname, search } = useLocation();
  const isLanding = pathname !== PRODUCT_ROUTES.projects;
  const dashboard = useProjectDashboard(!isLanding && Boolean(user));
  const projects = Array.from(new Map((dashboard.data?.pages ?? []).flatMap(page => page.items).map(project => [project.id, project])).values());
  usePageMeta({ title: isLanding ? "Buildy — Maak van je verbouwing een verhaal om te bewaren" : "Jouw projecten — Buildy", description: "Leg je bouwproject vast, volg andere bouwers en zie automatisch je eigen fotoboek ontstaan.", path: isLanding ? PRODUCT_ROUTES.landing : PRODUCT_ROUTES.projects, noIndex: !isLanding });
  if (isLanding && user) return <Navigate to={`${search ? PRODUCT_ROUTES.projects : PRODUCT_ROUTES.following}${search}`} replace />;
  if (!isLanding && authLoading) return <main className="min-h-[55vh]"><AsyncState status="loading" title="Account controleren" /></main>;
  if (!isLanding && !user) return <Navigate to={authPagePath(PRODUCT_ROUTES.projects)} replace />;

  if (!isLanding) return (
    <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6 lg:py-12">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-5">
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-accent">Hier gebeurt het</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Jouw projecten</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Van eerste idee tot de laatste verfstreek.</p></div>
        <Button asChild variant="outline" className="min-h-11 rounded-full bg-card"><Link to={PRODUCT_ROUTES.newProject}><Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Nieuw project</Link></Button>
      </header>
      {dashboard.isPending ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Verbouwingen laden">{[0,1,2].map(i => <div key={i} className="aspect-[4/3] animate-pulse rounded-3xl bg-muted motion-reduce:animate-none" />)}</div> : dashboard.isError ? (
        <AsyncState status="error" title="Je projecten zijn even niet bereikbaar" description="Controleer je verbinding en probeer het opnieuw." action={<Button variant="outline" onClick={() => void dashboard.refetch()}>Opnieuw proberen</Button>} />
      ) : projects.length === 0 ? (
        <section className="grid overflow-hidden rounded-3xl border border-border bg-card md:grid-cols-2">
          <img src="/images/buildy-renovation-progress.webp" alt="Een huis in verbouwing, klaar voor een nieuw verhaal" className="aspect-[16/9] h-full w-full object-cover" />
          <div className="flex flex-col items-start justify-center p-6 sm:p-9"><Camera className="mb-4 h-7 w-7 text-accent" aria-hidden="true" /><h2 className="text-2xl font-bold tracking-tight">Dit is het begin van jouw verhaal.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Een kleine klus of een heel nieuw huis. Bewaar de foto’s, de keuzes en de momenten waar je trots op bent.</p><Button asChild className="mt-6 min-h-12 rounded-full bg-accent px-6 text-white hover:bg-accent/90"><Link to={PRODUCT_ROUTES.newProject}>Begin je eerste project <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></Button><Link to={PRODUCT_ROUTES.connections} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary">Liever eerst bij anderen meekijken</Link></div>
        </section>
      ) : (
        <>
          <div className="mb-7 flex items-center gap-4 rounded-2xl bg-primary p-5 text-white">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10"><Camera className="h-5 w-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1"><p className="font-semibold">Wat is er vandaag veranderd?</p><p className="mt-1 text-xs leading-5 text-white/70">Eén foto houdt je verhaal levend.</p></div>
            <Button asChild size="icon" className="h-11 w-11 shrink-0 rounded-full bg-white text-primary hover:bg-white/90"><Link to={projects.length === 1 ? PRODUCT_ROUTES.projectUpdateComposer(projects[0].id) : PRODUCT_ROUTES.createUpdate} aria-label="Bouwmoment toevoegen"><Plus className="h-5 w-5" aria-hidden="true" /></Link></Button>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{projects.map(project => <ProjectCard key={project.id} id={project.id} title={project.title} projectType={project.projectType} progressPercentage={project.progressPercentage} coverUrl={project.cover?.proxyPath} coverMediaType={project.cover?.contentType} profileName={project.owner.displayName} updateCount={project.updateCount} visibility={project.visibility} />)}</div>
        </>
      )}
      {dashboard.hasNextPage ? <div className="mt-8 text-center"><Button variant="outline" className="min-h-11" disabled={dashboard.isFetchingNextPage} onClick={() => void dashboard.fetchNextPage()}>{dashboard.isFetchingNextPage ? "Projecten laden…" : "Meer projecten laden"}</Button></div> : null}
    </main>
  );

  return (
    <main className="bg-card">
      <section className="relative overflow-hidden bg-primary text-white" aria-labelledby="home-title">
        <div className="mx-auto grid max-w-7xl lg:min-h-[680px] lg:grid-cols-2">
          <div className="relative z-10 px-5 pb-9 pt-10 sm:px-8 sm:py-14 lg:py-24">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/70"><span className="h-1.5 w-1.5 rounded-full bg-[#EDBA9F]" aria-hidden="true" /> Voor iedereen die iets moois bouwt</p>
            <h1 id="home-title" className="mt-5 max-w-xl text-[clamp(2.7rem,6vw,5rem)] font-bold leading-[1.02] tracking-[-0.05em]">Jouw huis.<br />Jouw avontuur.<br /><span className="font-serif font-normal italic tracking-normal text-[#E9C9AD]">Jouw verhaal.</span></h1>
            <p className="mt-6 max-w-md text-base leading-7 text-white/75">Van de eerste sloopdag tot eindelijk thuiskomen. Leg het vast, laat je mensen meeleven en zie je eigen Bouwboek ontstaan.</p>
            <div className="mt-7 flex flex-wrap gap-3"><Button asChild className="min-h-12 rounded-full bg-accent px-6 text-base text-white hover:bg-accent/90"><Link to="/auth">Start je verbouwverhaal <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></Button><a href="#zo-werkt-het" className="inline-flex min-h-12 items-center gap-2 px-2 text-sm font-semibold text-white">Zo werkt Buildy <span aria-hidden="true">↓</span></a></div>
            <p className="mt-5 flex items-center gap-2 text-xs text-white/65"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Gratis beginnen. Je project start privé.</p>
          </div>
          <div className="relative min-h-[350px] sm:min-h-[430px] lg:min-h-full">
            <img src="/images/buildy-renovation-complete.webp" alt="Een verbouwde woonkamer met warm daglicht" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
            <div className="absolute inset-x-5 bottom-6 max-w-sm rounded-2xl border border-white/25 bg-white/95 p-4 text-foreground shadow-xl backdrop-blur sm:left-8">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-accent"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span> Voorbeeld · een mijlpaal</div>
              <p className="mt-2 text-xl font-semibold tracking-tight">We wonen weer beneden.</p><p className="mt-1 text-sm text-muted-foreground">Van bouwstof naar blote voeten op de vloer.</p>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs font-medium text-primary"><BookOpen className="h-4 w-4" aria-hidden="true" /> Ook een nieuwe bladzijde in je Bouwboek.</div>
            </div>
          </div>
        </div>
      </section>

      <section id="zo-werkt-het" className="scroll-mt-20" aria-labelledby="how-title">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Jij bouwt. Buildy bewaart.</p><h2 id="how-title" className="mt-3 max-w-xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Het grote verhaal zit in de kleine momenten.</h2>
          <div className="mt-9 grid gap-8 md:grid-cols-3">{[
            {icon:Camera,title:"Leg het vast",text:"Foto’s, een datum en een paar woorden. Meer heb je niet nodig voor een nieuw Bouwmoment."},
            {icon:Users,title:"Beleef het samen",text:"Volg je favoriete bouwers en projecten. Vier de mijlpalen met een reactie, emoji of een lief bericht."},
            {icon:BookOpen,title:"Bewaar het voor altijd",text:"Je Bouwboek wordt automatisch samengesteld uit je project. Kies je foto’s en download je persoonlijke PDF."},
          ].map(({icon:Icon,title,text},index) => <div key={title} className="relative border-t border-border pt-6"><span className="absolute -top-4 right-0 bg-card px-2 text-xs font-medium text-muted-foreground">0{index+1}</span><Icon className="mb-4 h-7 w-7 text-primary" strokeWidth={1.5} aria-hidden="true" /><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></div>)}</div>
        </div>
      </section>

      <section className="bg-secondary" aria-labelledby="transformation-title">
        <div className="mx-auto grid max-w-6xl items-center gap-9 px-5 py-12 sm:px-8 sm:py-16 md:grid-cols-2">
          <div className="overflow-hidden rounded-3xl"><BeforeAfterSlider beforeUrl="/images/buildy-renovation-progress.webp" afterUrl="/images/buildy-renovation-complete.webp" /><p className="mt-3 text-center text-xs text-muted-foreground">Voorbeeldproject · schuif om de verandering te zien</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">Kijk eens hoe ver je bent</p><h2 id="transformation-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Van “waar zijn we aan begonnen” tot “dit hebben wij gemaakt”.</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">Op drukke bouwdagen vergeet je snel hoe het eerst was. In je tijdlijn zie je iedere stap terug. De rommel, de keuzes en de kleine overwinningen horen er allemaal bij.</p><Link to="/auth" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary">Begin jouw verhaal <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
        </div>
      </section>

      <section id="voorbeeld" className="scroll-mt-20" aria-labelledby="book-title">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-5 py-14 sm:px-8 sm:py-20 md:grid-cols-2">
          <div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">Van project naar fotoboek</p><h2 id="book-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Een boek dat met je meegroeit.</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">Alle foto’s en verhalen staan vanzelf in de juiste volgorde. Jij geeft de cover, fotoselectie en indeling jouw eigen draai. Ook je allereerste Bouwmoment verdient een boek.</p><ul className="mt-5 space-y-3 text-sm">{["Automatisch samengesteld per project","Jouw foto’s, woorden en herinneringen","Gratis digitaal Bouwboek als PDF"].map(text=><li key={text} className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" aria-hidden="true" />{text}</li>)}</ul></div>
          <figure className="overflow-hidden rounded-3xl bg-secondary"><img src="/images/buildy-bouwboek-preview.webp" alt="Voorbeeld van een open Bouwboek met een verbouwing voor en na" className="aspect-[4/3] w-full object-cover" loading="lazy" /><figcaption className="px-5 pb-4 text-xs text-muted-foreground">Voorbeeld van een persoonlijk Bouwboek</figcaption></figure>
        </div>
      </section>

      <section className="border-y border-border bg-background">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8"><h2 className="text-2xl font-bold tracking-tight">Probeer het met jouw foto.</h2><p className="mb-6 mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Zie je foto als Bouwmoment en op een boekpagina. De foto blijft op dit apparaat totdat jij hem bewaart.</p><LocalPhotoDemo saveHref={LOCAL_PHOTO_AUTH_PATH} /></div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-14 text-center sm:py-20"><ShieldCheck className="mx-auto h-8 w-8 text-primary" aria-hidden="true" /><h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Jouw huis. Jij kiest wie er meekijkt.</h2><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-muted-foreground">Je begint met Alleen ik. Deel later met geaccepteerde volgers, via een tijdelijke deellink of openbaar. Je kunt die keuze altijd aanpassen.</p><Button asChild className="mt-7 min-h-12 rounded-full bg-accent px-7 text-white hover:bg-accent/90"><Link to="/auth">Begin gratis met Buildy <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></Button></section>
    </main>
  );
};
export default Index;
