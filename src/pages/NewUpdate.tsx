import { ArrowRight, Camera, Loader2, Plus, RefreshCw } from "lucide-react";
import { useMemo } from "react";

import AsyncState from "@/components/app/AsyncState";
import PrivacyBadge from "@/components/app/PrivacyBadge";
import { ResilientImage, ResilientVideo } from "@/components/ResilientMedia";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useProjectDashboard } from "@/hooks/useProjectApi";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, Navigate } from "@/lib/router";

const NewUpdate = () => {
  const { user, loading: authLoading } = useAuth();
  const dashboardQuery = useProjectDashboard(Boolean(user));
  const projects = useMemo(() => {
    const unique = new Map(
      (dashboardQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((project) => [project.id, project] as const),
    );
    return [...unique.values()];
  }, [dashboardQuery.data]);

  usePageMeta({
    title: "Nieuw Bouwmoment — Buildy",
    description: "Kies een verbouwing en leg direct een nieuw Bouwmoment vast.",
    path: PRODUCT_ROUTES.createUpdate,
    noIndex: true,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Account controleren…</span>
      </div>
    );
  }

  if (!user) return <Navigate to={authPagePath(PRODUCT_ROUTES.createUpdate)} replace />;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 md:py-16">
      <header className="mb-9 border-b border-border pb-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Nieuw Bouwmoment</p>
        <h1 className="max-w-2xl font-serif text-4xl leading-tight md:text-5xl">Aan welke verbouwing werk je?</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Kies je verbouwing. Op de pagina opent de Bouwmoment-editor meteen voor je.
        </p>
      </header>

      {dashboardQuery.isPending ? (
        <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Verbouwingen laden…
        </p>
      ) : dashboardQuery.isError ? (
        <AsyncState
          status="error"
          title="Je verbouwingen zijn even niet bereikbaar"
          description="We tonen geen eerder geladen privéverbouwingen wanneer de toegangscontrole mislukt. Probeer het opnieuw."
          action={(
            <Button variant="outline" className="gap-2" onClick={() => void dashboardQuery.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen
            </Button>
          )}
        />
      ) : projects.length === 0 ? (
        <AsyncState
          status="empty"
          icon={<Camera className="h-6 w-6" aria-hidden="true" />}
          title="Maak eerst een verbouwing"
          description="Een Bouwmoment hoort altijd bij één van jouw verbouwingen. Maak die aan en leg daarna het eerste moment vast."
          action={(
            <Button asChild>
              <Link to={PRODUCT_ROUTES.newProject}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Nieuwe verbouwing
              </Link>
            </Button>
          )}
        />
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2" role="list">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to={PRODUCT_ROUTES.projectUpdateComposer(project.id)}
                  className="group grid min-h-32 grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-4 border border-border bg-card p-3 outline-none transition-colors hover:border-accent/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={`Nieuw Bouwmoment toevoegen aan ${project.title}`}
                >
                  <span className="flex aspect-square items-center justify-center overflow-hidden bg-secondary text-muted-foreground">
                    {project.cover?.proxyPath ? (
                      project.cover.contentType?.startsWith("video/") ? (
                        <ResilientVideo
                          src={project.cover.proxyPath}
                          muted
                          playsInline
                          preload="metadata"
                          aria-hidden="true"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ResilientImage
                          src={project.cover.proxyPath}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )
                    ) : (
                      <Camera className="h-6 w-6" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold">{project.title}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <PrivacyBadge level={project.visibility === "public" ? "public" : "private"} />
                      <span>{project.updateCount === 1 ? "1 Bouwmoment" : `${project.updateCount} Bouwmomenten`}</span>
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>

          {dashboardQuery.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={dashboardQuery.isFetchingNextPage}
                onClick={() => void dashboardQuery.fetchNextPage()}
              >
                {dashboardQuery.isFetchingNextPage ? "Verbouwingen laden…" : "Meer verbouwingen laden"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
};

export default NewUpdate;
