import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import { ArrowUpRight, Flag, Heart, Home, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

import CommentsSheet from "@/components/CommentsSheet";
import EmptyState from "@/components/EmptyState";
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
  usePageMeta({
    title: "Verbouwingen die ik volg — Buildy",
    description: "Bekijk bouwmomenten van verbouwingen die je volgt.",
    path: PRODUCT_ROUTES.following,
    noIndex: true,
  });

  if (authLoading) return <main className="min-h-screen bg-background" />;
  if (!user) return <Navigate to={authPagePath(PRODUCT_ROUTES.following)} replace />;

  const projects = feedQuery.data?.projects ?? [];
  const activity = feedQuery.data?.activity ?? [];
  const selectedActivity = activity.find(({ update }) => update.id === openComments);

  return (
    <main className="mx-auto max-w-3xl py-8 sm:px-6 sm:py-12">
      <div className="mb-7 px-5 sm:px-0">
        <p className="eyebrow mb-2">Samen beleven</p>
        <h1 className="font-serif text-4xl md:text-5xl">Volgend</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Nieuwe momenten van de verbouwingen die je volgt. Kijk mee en laat iets van je horen.
        </p>
      </div>

      {feedQuery.isPending ? (
        <p className="flex items-center gap-2 px-5 text-sm text-muted-foreground sm:px-0" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Gevolgde verbouwingen laden…
        </p>
      ) : feedQuery.isError ? (
        <section className="mx-5 rounded-lg border border-dashed p-8 text-center sm:mx-0" role="alert">
          <h2 className="font-semibold">Je feed kon niet worden geladen</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Probeer opnieuw om de nieuwste Bouwmomenten te bekijken.
          </p>
          <Button className="mt-5 gap-2" variant="outline" onClick={() => void feedQuery.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen
          </Button>
        </section>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Kijk mee met een verbouwing"
          description="Open een deellink van familie of vrienden en kies ‘Volg deze verbouwing’. De Bouwmomenten die je mag bekijken vind je hier terug."
        />
      ) : (
        <Tabs defaultValue="feed">
          <TabsList className="mb-5 flex h-auto justify-start gap-7 rounded-none border-b border-border bg-transparent px-5 sm:px-0">
            <TabsTrigger value="feed" className="min-h-11 rounded-none border-b-2 border-transparent px-0 text-sm font-semibold text-muted-foreground data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
              Recent
            </TabsTrigger>
            <TabsTrigger value="projects" className="min-h-11 rounded-none border-b-2 border-transparent px-0 text-sm font-semibold text-muted-foreground data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
              Verbouwingen ({projects.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="feed">
            {activity.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground sm:px-0">Nog geen Bouwmomenten. Zodra er iets te zien is, vind je het hier.</p>
            ) : (
              <div className="space-y-8 sm:space-y-10">
                {activity.map(({ project, update }) => {
                  const photos = update.media.filter((media) => (
                    media.contentType !== "application/pdf" && !media.contentType?.startsWith("video/")
                  ));
                  const firstPhoto = photos[0];
                  const timestamp = update.publishedAt ?? update.updatedAt;
                  const momentHref = PRODUCT_ROUTES.projectUpdate(project.id, update.id);
                  const title = update.title?.trim() || update.room?.trim() || "Bouwmoment";
                  return (
                    <article
                      key={update.id}
                      className="overflow-hidden border-y border-border bg-card sm:rounded-xl sm:border"
                    >
                      <header className="flex min-h-16 items-center gap-3 px-5 py-2">
                        <Link to={PRODUCT_ROUTES.project(project.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 font-semibold text-accent hover:underline">
                          <Home className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="truncate text-sm">{project.title}</span>
                        </Link>
                        <time dateTime={timestamp} className="shrink-0 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: nl })}
                        </time>
                      </header>

                      {firstPhoto ? (
                        <Link to={momentHref} aria-label={`Bekijk ${title}`} className="relative block aspect-[4/3] w-full overflow-hidden bg-muted">
                          <ResilientImage
                            src={firstPhoto.proxyPath}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          {photos.length > 1 ? <span className="absolute bottom-3 right-3 rounded-full bg-background/95 px-3 py-1 text-xs font-medium text-foreground">{photos.length} foto’s</span> : null}
                        </Link>
                      ) : null}

                      <div className="px-5 pb-4 pt-5">
                        <div className="flex flex-wrap items-center gap-2">
                          {update.phase ? (
                            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${phaseColor(update.phase.name)}`}>
                              {update.phase.name}
                            </span>
                          ) : null}
                          {update.isMilestone ? (
                            <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
                              <Flag className="h-3 w-3" aria-hidden="true" /> Mijlpaal
                            </span>
                          ) : null}
                        </div>
                        <h2 className="mt-2 font-serif text-3xl leading-tight"><Link to={momentHref} className="inline-flex min-h-11 items-center hover:text-accent">{title}</Link></h2>
                        {update.description ? (
                          <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">{update.description}</p>
                        ) : null}
                        <Link to={momentHref} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent">
                          Bekijk het Verhaal <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                          <ReactionBar projectId={project.id} updateId={update.id} />
                          <button
                            type="button"
                            aria-label={`Opmerkingen bij ${title} openen`}
                            onClick={() => setOpenComments(update.id)}
                            className="flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-accent"
                          >
                            <MessageCircle className="h-4 w-4" aria-hidden="true" /> Opmerkingen
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects">
            <div className="grid grid-cols-1 gap-x-8 gap-y-12 px-5 py-3 sm:px-0 md:grid-cols-2">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  id={project.id}
                  title={project.title}
                  projectType={project.projectType}
                  progressPercentage={project.progressPercentage}
                  coverUrl={project.cover?.proxyPath}
                  coverMediaType={project.cover?.contentType}
                  profileName={project.owner.displayName}
                  updateCount={project.updateCount}
                  visibility={project.visibility}
                />
              ))}
            </div>
          </TabsContent>
          {selectedActivity ? (
            <CommentsSheet
              projectId={selectedActivity.project.id}
              updateId={selectedActivity.update.id}
              open
              onOpenChange={(open) => { if (!open) setOpenComments(null); }}
            />
          ) : null}
        </Tabs>
      )}
    </main>
  );
};

export default Favorites;
