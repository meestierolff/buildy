import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import { ArrowUpRight, Camera, Flag, Heart, Loader2, MessageCircle, Plus, RefreshCw, Users } from "lucide-react";
import { useState } from "react";

import CommentsSheet from "@/components/CommentsSheet";
import { phaseColor } from "@/components/PhaseSelect";
import ProjectCard from "@/components/ProjectCard";
import ReactionBar from "@/components/ReactionBar";
import { ResilientImage } from "@/components/ResilientMedia";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useFollowingFeed } from "@/hooks/useProjectApi";
import { Link, Navigate } from "@/lib/router";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

const Favorites = () => {
  const { user, loading: authLoading } = useAuth();
  const feedQuery = useFollowingFeed(Boolean(user));
  const [openComments, setOpenComments] = useState<string | null>(null);
  usePageMeta({ title: "Jouw tijdlijn — Buildy", description: "Nieuwe Bouwmomenten van de bouwers en projecten die je volgt.", path: PRODUCT_ROUTES.following, noIndex: true });

  if (authLoading) return <main className="min-h-screen bg-background" />;
  if (!user) return <Navigate to={authPagePath(PRODUCT_ROUTES.following)} replace />;

  const projects = feedQuery.data?.projects ?? [];
  const activity = feedQuery.data?.activity ?? [];
  const selectedActivity = activity.find(({ update }) => update.id === openComments);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-9">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Samen bouwen, samen beleven</p>
          <h1 className="text-3xl font-bold tracking-tight">Jouw tijdlijn</h1>
        </div>
        <Button asChild variant="outline" size="icon" className="h-11 w-11 shrink-0 rounded-full bg-card">
          <Link to={PRODUCT_ROUTES.connections} aria-label="Bouwers zoeken"><Users className="h-5 w-5" /></Link>
        </Button>
      </div>
      <Link to={PRODUCT_ROUTES.createUpdate} className="mb-6 flex min-h-20 items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><Camera className="h-5 w-5" aria-hidden="true" /></span>
        <span className="flex-1"><span className="block text-sm font-semibold">Wat is er vandaag veranderd?</span><span className="mt-0.5 block text-xs text-muted-foreground">Bewaar een foto, groot of klein.</span></span>
        <Plus className="h-5 w-5 text-accent" aria-hidden="true" />
      </Link>

      {feedQuery.isPending ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Bouwmomenten laden…</p>
      ) : feedQuery.isError ? (
        <section className="rounded-2xl border border-border bg-card p-7 text-center" role="alert">
          <h2 className="font-semibold">Je tijdlijn kon niet worden geladen</h2>
          <p className="mt-2 text-sm text-muted-foreground">Probeer opnieuw om de nieuwste Bouwmomenten te bekijken.</p>
          <Button className="mt-5 min-h-11 gap-2" variant="outline" onClick={() => void feedQuery.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen</Button>
        </section>
      ) : projects.length === 0 ? (
        <section className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
          <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-primary"><Heart className="h-6 w-6" aria-hidden="true" /></span>
          <h2 className="text-xl font-semibold tracking-tight">Een verbouwing beleef je samen</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Volg een bouwer of open een gedeeld project van vrienden. Hun nieuwe Bouwmomenten komen hier samen.</p>
          <Button asChild className="mt-6 min-h-11 gap-2"><Link to={PRODUCT_ROUTES.connections}><Users className="h-4 w-4" aria-hidden="true" /> Zoek een bouwer</Link></Button>
        </section>
      ) : (
        <Tabs defaultValue="feed">
          <TabsList className="mb-5 grid h-11 w-full grid-cols-2 rounded-xl bg-secondary p-1">
            <TabsTrigger value="feed" className="h-9 rounded-lg text-sm data-[state=active]:bg-card">Bouwmomenten</TabsTrigger>
            <TabsTrigger value="projects" className="h-9 rounded-lg text-sm data-[state=active]:bg-card">Projecten ({projects.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="feed">
            {activity.length === 0 ? (
              <p className="rounded-2xl border bg-card px-5 py-8 text-sm leading-6 text-muted-foreground">Nog geen Bouwmomenten. Zodra er iets te zien is, vind je het hier.</p>
            ) : (
              <div className="space-y-5">
                {activity.map(({ project, update }) => {
                  const photos = update.media.filter((media) => media.contentType !== "application/pdf" && !media.contentType?.startsWith("video/"));
                  const timestamp = update.publishedAt ?? update.updatedAt;
                  const momentHref = PRODUCT_ROUTES.projectUpdate(project.id, update.id);
                  const title = update.title?.trim() || update.room?.trim() || "Bouwmoment";
                  const owner = project.owner;
                  return (
                    <article key={update.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                      <header className="flex min-h-20 items-center gap-3 px-4 py-3">
                        <Link to={owner ? PRODUCT_ROUTES.profile(owner.slug) : PRODUCT_ROUTES.project(project.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-primary" aria-label={owner ? `Profiel van ${owner.displayName}` : project.title}>
                          {(owner?.displayName ?? project.title).slice(0, 1).toUpperCase()}
                        </Link>
                        <div className="min-w-0 flex-1">
                          <Link to={owner ? PRODUCT_ROUTES.profile(owner.slug) : PRODUCT_ROUTES.project(project.id)} className="block truncate text-sm font-semibold hover:underline">{owner?.displayName ?? project.title}</Link>
                          <Link to={PRODUCT_ROUTES.project(project.id)} className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-primary">{project.title}</Link>
                        </div>
                        <time dateTime={timestamp} className="max-w-24 shrink-0 text-right text-[11px] leading-4 text-muted-foreground">{formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: nl })}</time>
                      </header>
                      {photos.length ? (
                        <div className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-muted" aria-label={`Foto’s van ${title}`} tabIndex={photos.length > 1 ? 0 : undefined}>
                          {photos.map((photo, index) => (
                            <Link key={photo.id} to={momentHref} aria-label={`Bekijk ${title}, foto ${index + 1} van ${photos.length}`} className="relative block aspect-[4/3] w-full shrink-0 snap-center overflow-hidden">
                              <ResilientImage src={photo.proxyPath} alt="" loading="lazy" className="h-full w-full object-cover" />
                              {photos.length > 1 ? <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white">{index + 1} / {photos.length}</span> : null}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                      <div className="px-4 pb-3 pt-4">
                        {update.phase || update.isMilestone ? <div className="mb-2 flex flex-wrap items-center gap-2">
                          {update.phase ? <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${phaseColor(update.phase.name)}`}>{update.phase.name}</span> : null}
                          {update.isMilestone ? <span className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent"><Flag className="h-3 w-3" aria-hidden="true" /> Mijlpaal</span> : null}
                        </div> : null}
                        <h2 className="text-xl font-semibold leading-tight tracking-tight"><Link to={momentHref} className="hover:text-primary">{title}</Link></h2>
                        {update.description ? <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">{update.description}</p> : null}
                        <Link to={momentHref} className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary">Bekijk het verhaal <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                          <ReactionBar projectId={project.id} updateId={update.id} />
                          <button type="button" aria-label={`Opmerkingen bij ${title} openen`} onClick={() => setOpenComments(update.id)} className="flex min-h-11 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary"><MessageCircle className="h-4 w-4" aria-hidden="true" /> Opmerkingen</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>
          <TabsContent value="projects">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {projects.map((project) => <ProjectCard key={project.id} id={project.id} title={project.title} projectType={project.projectType} progressPercentage={project.progressPercentage} coverUrl={project.cover?.proxyPath} coverMediaType={project.cover?.contentType} profileName={project.owner.displayName} updateCount={project.updateCount} visibility={project.visibility} />)}
            </div>
          </TabsContent>
          {selectedActivity ? <CommentsSheet projectId={selectedActivity.project.id} updateId={selectedActivity.update.id} open onOpenChange={(open) => { if (!open) setOpenComments(null); }} /> : null}
        </Tabs>
      )}
    </main>
  );
};
export default Favorites;
