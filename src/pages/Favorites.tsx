import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import { Flag, Heart, Home, Loader2, RefreshCw } from "lucide-react";

import EmptyState from "@/components/EmptyState";
import { phaseColor } from "@/components/PhaseSelect";
import ProjectCard from "@/components/ProjectCard";
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

  return (
    <main className="mx-auto max-w-7xl px-6 py-16 md:px-8">
      <div className="mb-12">
        <p className="eyebrow mb-2">Jouw feed</p>
        <h1 className="font-serif text-4xl italic md:text-5xl">Volgend</h1>
      </div>

      {feedQuery.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Gevolgde verbouwingen laden…
        </p>
      ) : feedQuery.isError ? (
        <section className="rounded-lg border border-dashed p-8 text-center" role="alert">
          <h2 className="font-semibold">Je feed kon niet worden geladen</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We tonen geen eerder geladen privéverbouwingen wanneer de toegangscontrole mislukt.
          </p>
          <Button className="mt-5 gap-2" variant="outline" onClick={() => void feedQuery.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen
          </Button>
        </section>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Je volgt nog niks"
          description="Volg een bouwer om nieuwe bouwmomenten hier terug te zien."
        />
      ) : (
        <Tabs defaultValue="feed">
          <TabsList className="mb-8 h-auto gap-8 rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger value="feed" className="rounded-none border-b-2 border-transparent px-0 pb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
              Recent
            </TabsTrigger>
            <TabsTrigger value="projects" className="rounded-none border-b-2 border-transparent px-0 pb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
              Verbouwingen ({projects.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="feed">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nog geen gepubliceerde bouwmomenten van verbouwingen die je volgt.</p>
            ) : (
              <div className="max-w-lg divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
                {activity.map(({ project, update }) => {
                  const firstPhoto = update.media.find((media) => (
                    media.contentType !== "application/pdf" && !media.contentType?.startsWith("video/")
                  ));
                  const timestamp = update.publishedAt ?? update.updatedAt;
                  return (
                    <Link
                      key={update.id}
                      to={PRODUCT_ROUTES.projectUpdate(project.id, update.id)}
                      className="block bg-card transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                        <Home className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                        <span className="truncate text-[11px] font-semibold text-accent">{project.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: nl })}
                        </span>
                      </div>

                      {firstPhoto ? (
                        <div className="aspect-[4/3] w-full">
                          <ResilientImage
                            src={firstPhoto.proxyPath}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ) : null}

                      <div className="space-y-1 px-4 pb-3 pt-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {update.phase ? (
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${phaseColor(update.phase.name)}`}>
                              {update.phase.name}
                            </span>
                          ) : null}
                          {update.isMilestone ? (
                            <span className="flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
                              <Flag className="h-2.5 w-2.5" aria-hidden="true" /> Mijlpaal
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm font-bold leading-tight">{update.title ?? update.room ?? "Bouwmoment"}</p>
                        {update.description ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground">{update.description}</p>
                        ) : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects">
            <div className="grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
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
        </Tabs>
      )}
    </main>
  );
};

export default Favorites;
