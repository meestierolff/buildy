import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Camera,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import AsyncState from "@/components/app/AsyncState";
import PrivacyBadge from "@/components/app/PrivacyBadge";
import ProjectCard from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useProjectDashboard, useProjectDiscovery } from "@/hooks/useProjectApi";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, Navigate, useLocation } from "@/lib/router";
import type { ProjectCard as Project } from "../../shared/contracts/projects";
type ProjectTab = "discover" | "mine";

interface Principle {
  icon: LucideIcon;
  title: string;
  description: string;
}

const CORE_STEPS: Principle[] = [
  {
    icon: Camera,
    title: "Leg vast wat er gebeurt",
    description: "Maak per fase een update met foto’s, keuzes, kosten en de kleine momenten die je later anders vergeet.",
  },
  {
    icon: Users,
    title: "Laat mensen gericht meekijken",
    description: "Je project begint privé. Deel het daarna met bekenden of zet alleen het verhaal bewust openbaar.",
  },
  {
    icon: BookOpen,
    title: "Maak er een Bouwboek van",
    description: "Je tijdlijn vormt de basis voor een persoonlijk fotoboek, zonder dat je vanaf nul een album hoeft te ontwerpen.",
  },
];

const PRIVACY_LEVELS = [
  {
    level: "private" as const,
    title: "Privé als vertrekpunt",
    description: "Alleen jij ziet het project totdat je zelf toegang geeft.",
  },
  {
    level: "shared" as const,
    title: "Gedeeld met jouw kring",
    description: "Nodig gericht vrienden of familie uit om mee te kijken.",
  },
  {
    level: "public" as const,
    title: "Openbaar als bewuste keuze",
    description: "Alleen dan kan het project in Ontdekken verschijnen. Adres, budget en werkaantekeningen horen daar niet automatisch bij.",
  },
];

const looksLikeVideo = (url: string | null | undefined, mediaType: string | null | undefined) =>
  mediaType === "video" || /\.(mp4|mov|webm)(\?|#|$)/i.test(url ?? "");

const ProjectSkeleton = ({ feature = false }: { feature?: boolean }) => (
  <div className={feature ? "lg:col-span-7" : "lg:col-span-5"} aria-hidden="true">
    <div className={`${feature ? "aspect-[16/10]" : "aspect-[4/5]"} animate-pulse rounded-sm bg-muted motion-reduce:animate-none`} />
    <div className="mt-4 h-px bg-border" />
    <div className="mt-4 h-7 w-2/3 animate-pulse bg-muted motion-reduce:animate-none" />
    <div className="mt-3 h-4 w-1/3 animate-pulse bg-muted motion-reduce:animate-none" />
  </div>
);

const ProjectCollection = ({
  projects,
  loading,
  emptyState,
}: {
  projects: Project[];
  loading: boolean;
  emptyState: ReactNode;
}) => {
  if (loading) {
    return (
      <div
        className="grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-12"
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Projecten laden"
      >
        <ProjectSkeleton feature />
        <ProjectSkeleton />
        <span className="sr-only">Projecten laden…</span>
      </div>
    );
  }

  if (projects.length === 0) return <>{emptyState}</>;

  const projectGroups = Array.from(
    { length: Math.ceil(projects.length / 5) },
    (_, groupIndex) => projects.slice(groupIndex * 5, groupIndex * 5 + 5),
  );

  const getLayout = (groupLength: number, index: number) => {
    if (groupLength === 1) return { className: "lg:col-span-8 lg:col-start-3", feature: true };
    if (groupLength === 2) {
      return index === 0
        ? { className: "lg:col-span-7", feature: true }
        : { className: "lg:col-span-5", feature: false };
    }
    if (groupLength === 3) {
      return index === 0
        ? { className: "lg:col-span-6", feature: true }
        : { className: "lg:col-span-3", feature: false };
    }
    if (groupLength === 4) {
      const feature = index === 0 || index === 3;
      return {
        className: feature ? "lg:col-span-8" : "lg:col-span-4",
        feature,
      };
    }
    return index === 0
      ? { className: "lg:col-span-7", feature: true }
      : index === 1
        ? { className: "lg:col-span-5", feature: false }
        : { className: "lg:col-span-4", feature: false };
  };

  return (
    <div className="space-y-14">
      {projectGroups.map((group) => (
        <div key={group[0].id} className="grid grid-cols-1 gap-x-8 gap-y-14 md:grid-cols-2 lg:grid-cols-12">
          {group.map((project, index) => {
            const layout = getLayout(group.length, index);
            return (
              <div key={project.id} className={layout.className}>
                <ProjectCard
                  id={project.id}
                  title={project.title}
                  projectType={project.projectType}
                  progressPercentage={project.progressPercentage}
                  coverUrl={project.cover?.proxyPath}
                  coverMediaType={project.cover?.contentType}
                  profileName={project.owner.displayName}
                  updateCount={project.updateCount}
                  isPublic={project.visibility === "public"}
                  variant={layout.feature ? "feature" : "standard"}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const HeroProject = ({ project, loading }: { project?: Project; loading: boolean }) => {
  const media = project?.cover?.proxyPath;
  const video = looksLikeVideo(media, project?.cover?.contentType);

  return (
    <div className="relative lg:pl-8">
      <div className="absolute -left-2 top-10 hidden h-px w-16 bg-accent lg:block" aria-hidden="true" />
      <figure className="border-x border-b border-border bg-card">
        <div className="flex min-h-12 items-center justify-between border-y border-border px-4 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:px-5">
          <span>Uit een openbaar bouwverhaal</span>
          <span aria-hidden="true">Veldnotitie 01</span>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden bg-secondary sm:aspect-[16/11] lg:aspect-[4/3]">
          {loading ? (
            <div className="flex h-full w-full flex-col justify-end bg-secondary p-6 sm:p-8" role="status" aria-busy="true">
              <Camera className="h-10 w-10 text-muted-foreground" strokeWidth={1.2} aria-hidden="true" />
              <p className="mt-5 max-w-sm font-serif text-2xl leading-tight text-foreground">Openbaar voorbeeld wordt gecontroleerd.</p>
              <div className="mt-5 space-y-2" aria-hidden="true">
                <div className="h-2 w-3/4 animate-pulse bg-muted-foreground/15 motion-reduce:animate-none" />
                <div className="h-2 w-1/2 animate-pulse bg-muted-foreground/15 motion-reduce:animate-none" />
              </div>
              <span className="sr-only">Openbaar voorbeeldproject laden…</span>
            </div>
          ) : media ? (
            video ? (
              <video src={media} muted playsInline aria-hidden="true" preload="metadata" className="h-full w-full object-cover" />
            ) : (
              <img src={media} alt="" decoding="async" className="h-full w-full object-cover" />
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center text-muted-foreground">
              <Camera className="h-12 w-12" strokeWidth={1.1} aria-hidden="true" />
              <p className="max-w-xs font-serif text-2xl leading-tight text-foreground">Foto’s geven iedere bouwfase een plek.</p>
            </div>
          )}
          <div className="absolute left-4 top-4">
            <PrivacyBadge level="public" className="bg-background/95 shadow-sm" />
          </div>
        </div>
        <figcaption className="grid gap-3 border-t border-border px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-end sm:px-5">
          <div>
            <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Bewust gedeeld</p>
            <p className="mt-1 font-serif text-2xl leading-tight">{project?.title ?? "Een verbouwing in opbouw"}</p>
          </div>
          {project ? (
            <Link
              to={PRODUCT_ROUTES.project(project.id)}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            >
              Bekijk project <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <span className="font-sans text-xs text-muted-foreground">Alleen openbare projecten verschijnen hier.</span>
          )}
        </figcaption>
      </figure>
    </div>
  );
};

const BookPreview = ({ project }: { project?: Project }) => (
  <figure>
    <div className="mx-auto grid aspect-[8/5] w-full max-w-xl grid-cols-2 border border-foreground/15 bg-card shadow-xl">
      <div className="relative flex flex-col justify-between border-r border-border px-5 py-6 sm:px-8 sm:py-9">
        <div>
          <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.2em] text-accent sm:text-[11px]">Bouwboek</p>
          <p className="mt-4 font-serif text-2xl leading-[1.02] sm:text-4xl">Van klusplek naar thuis.</p>
        </div>
        <div className="border-t border-border pt-3 font-sans text-[9px] uppercase tracking-[0.16em] text-muted-foreground sm:text-[11px]">
          Eerste sleutel — laatste plint
        </div>
        <div className="absolute inset-y-0 right-1 w-px bg-border" aria-hidden="true" />
      </div>
      <div className="m-3 overflow-hidden bg-secondary sm:m-5">
        {project?.cover?.proxyPath ? (
          <img src={project.cover.proxyPath} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
            <BookOpen className="h-9 w-9" strokeWidth={1.2} aria-hidden="true" />
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em]">Jouw foto op papier</span>
          </div>
        )}
      </div>
    </div>
    <figcaption className="mx-auto mt-4 max-w-xl border-l-2 border-accent pl-4 font-sans text-xs leading-5 text-muted-foreground">
      Een rustige boekpreview groeit mee met je updates; jij kiest later welke momenten meegaan naar druk.
    </figcaption>
  </figure>
);

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-3 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{children}</p>
);

const Index = () => {
  const { user, loading: authLoading } = useAuth();
  const { pathname } = useLocation();
  const view = pathname === PRODUCT_ROUTES.projects
    ? "projects"
    : pathname === PRODUCT_ROUTES.discover
      ? "discover"
      : "landing";
  const tab: ProjectTab = view === "projects" ? "mine" : "discover";
  const isLanding = view === "landing";
  const ProjectHeading = isLanding ? "h2" : "h1";
  usePageMeta({
    title: view === "projects"
      ? "Mijn projecten — Buildy"
      : view === "discover"
        ? "Ontdek verbouwingsprojecten — Buildy"
        : "Buildy — Van eerste sleutel tot laatste plint",
    description: view === "projects"
      ? "Bekijk en beheer je eigen verbouwingsprojecten."
      : view === "discover"
        ? "Ontdek openbare verbouwingsverhalen die hun makers bewust delen."
        : "Leg je verbouwing stap voor stap vast, laat vrienden en familie meekijken en maak er later een Bouwboek van.",
    path: view === "projects"
      ? PRODUCT_ROUTES.projects
      : view === "discover"
        ? PRODUCT_ROUTES.discover
        : PRODUCT_ROUTES.landing,
    noIndex: view === "projects",
  });

  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const discoveryQuery = useProjectDiscovery(view !== "projects");
  const dashboardQuery = useProjectDashboard(view === "projects" && Boolean(user));
  const discover = Array.from(new Map(
    (discoveryQuery.data?.pages ?? []).flatMap((page) => page.items).map((project) => [project.id, project]),
  ).values());
  const mine = Array.from(new Map(
    (dashboardQuery.data?.pages ?? []).flatMap((page) => page.items).map((project) => [project.id, project]),
  ).values());
  const loadingDiscover = discoveryQuery.isPending;
  const loadingMine = dashboardQuery.isPending;
  const discoverError = discoveryQuery.isError;
  const mineError = dashboardQuery.isError;

  const query = search.trim().toLocaleLowerCase("nl-NL");
  const activeTypes = Array.from(new Set(discover.flatMap((project) => (
    project.projectType ? [project.projectType] : []
  )))).sort((a, b) => a.localeCompare(b, "nl-NL"));
  const filtered = discover.filter((project) => {
    const matchesSearch = !query
      || project.title.toLocaleLowerCase("nl-NL").includes(query)
      || project.owner.displayName.toLocaleLowerCase("nl-NL").includes(query);
    const matchesType = !selectedType || project.projectType === selectedType;
    return matchesSearch && matchesType;
  });

  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const shownProjectIds = new Set<string>();
  const takeUnique = (projects: Project[], limit = 5) => {
    const selection: Project[] = [];
    projects.forEach((project) => {
      if (selection.length >= limit || shownProjectIds.has(project.id)) return;
      shownProjectIds.add(project.id);
      selection.push(project);
    });
    return selection;
  };

  const active = takeUnique(
    [...filtered].sort((a, b) => b.updateCount - a.updateCount),
  );
  const recentlyStarted = takeUnique(
    filtered.filter((project) => project.updateCount === 0 || project.updatedAt > twoWeeksAgo),
  );
  const nearlyFinished = takeUnique(
    filtered.filter((project) => project.progressPercentage >= 70 && project.progressPercentage < 100),
  );
  const moreProjects = filtered.filter((project) => !shownProjectIds.has(project.id));
  const heroProject = discover.find((project) => project.cover) ?? discover[0];
  const bookProject = discover.find(
    (project) => project.cover && !looksLikeVideo(project.cover.proxyPath, project.cover.contentType),
  );

  const clearFilters = () => {
    setSearch("");
    setSelectedType("");
  };

  const renderProjectSection = (label: string, projects: Project[]) => {
    if (projects.length === 0) return null;
    return (
      <section aria-label={label}>
        <div className="mb-7 flex items-center gap-4 border-b border-border pb-3">
          <p className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-foreground">{label}</p>
          <span className="font-sans text-xs tabular-nums text-muted-foreground">{String(projects.length).padStart(2, "0")}</span>
        </div>
        <ProjectCollection projects={projects} loading={false} emptyState={null} />
      </section>
    );
  };

  if (view === "projects" && authLoading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center" role="status">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-hidden="true" />
        <span className="sr-only">Account controleren…</span>
      </div>
    );
  }

  if (view === "projects" && !user) {
    return <Navigate to={authPagePath(PRODUCT_ROUTES.projects)} replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      {isLanding ? (
        <>
          <section className="border-b border-border" aria-labelledby="home-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-12 sm:px-6 md:px-8 md:py-16 lg:min-h-[680px] lg:grid-cols-12 lg:gap-10 lg:py-20">
          <div className="lg:col-span-6 lg:pr-8">
            <div className="mb-7 flex items-center gap-3 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <span className="h-px w-10 bg-accent" aria-hidden="true" />
              Sociaal verbouwingsdagboek
            </div>
            <h1 id="home-title" className="max-w-2xl font-serif text-5xl leading-[0.94] tracking-[-0.025em] sm:text-6xl lg:text-[5rem]">
              Van eerste sleutel tot laatste plint.
            </h1>
            <p className="mt-7 max-w-xl font-sans text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
              Leg je verbouwing stap voor stap vast, laat vrienden en familie meekijken en maak er later een Bouwboek van.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="min-h-12 w-full rounded-md px-6 sm:w-auto">
                <Link to={user ? PRODUCT_ROUTES.newProject : "/auth?mode=register&next=%2Fproject%2Fnieuw"}>
                  {user ? <Plus className="h-4 w-4" aria-hidden="true" /> : null}
                  {user ? "Nieuw project starten" : "Start gratis je dagboek"}
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="min-h-12 w-full rounded-md bg-background px-6 sm:w-auto">
                <a href="#zo-werkt-het">Bekijk hoe het werkt <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
              </Button>
            </div>

            <aside className="mt-8 flex max-w-xl items-start gap-3 border-l-2 border-accent pl-4" aria-label="Privacybelofte">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div className="font-sans text-sm leading-6 text-muted-foreground">
                <p className="font-semibold text-foreground">Je begint privé.</p>
                <p>Jij kiest per project wie mag meekijken en wat bewust openbaar wordt.</p>
              </div>
            </aside>
          </div>

          <div className="lg:col-span-6">
            <HeroProject project={heroProject} loading={loadingDiscover} />
          </div>
        </div>
          </section>

          <section id="zo-werkt-het" className="scroll-mt-24 border-b border-border" aria-labelledby="how-title">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:px-8 md:py-20">
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <SectionLabel>Zo werkt Buildy</SectionLabel>
              <h2 id="how-title" className="max-w-lg font-serif text-4xl leading-[1.02] md:text-5xl">
                Drie stappen, één compleet bouwverhaal.
              </h2>
            </div>
            <p className="max-w-2xl font-sans text-base leading-7 text-muted-foreground lg:col-span-5 lg:col-start-8 lg:pt-7">
              Geen losse fotomap en geen ingewikkeld projectmanagement. Buildy houdt het dagelijks vastleggen licht en maakt de opbrengst later tastbaar.
            </p>
          </div>

          <ol className="mt-12 border-y border-border md:grid md:grid-cols-3">
            {CORE_STEPS.map(({ icon: Icon, title, description }, index) => (
              <li key={title} className="grid grid-cols-[3rem_1fr] gap-4 border-b border-border py-7 last:border-b-0 md:block md:border-b-0 md:border-r md:px-7 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
                <div className="flex items-center justify-between md:mb-10">
                  <span className="font-sans text-xs font-semibold tabular-nums text-accent">0{index + 1}</span>
                  <Icon className="hidden h-5 w-5 text-muted-foreground md:block" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-sans text-lg font-semibold tracking-[-0.02em]">{title}</h3>
                  <p className="mt-2 font-sans text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
          </section>

          <section className="border-b border-border bg-secondary/55" aria-labelledby="privacy-title">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:px-8 md:py-20 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionLabel>Privacy zonder kleine lettertjes</SectionLabel>
            <h2 id="privacy-title" className="max-w-lg font-serif text-4xl leading-[1.02] md:text-5xl">
              Jouw huis hoeft niet voor iedereen open te staan.
            </h2>
            <p className="mt-5 max-w-xl font-sans text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
              Je kunt delen zonder meteen alles publiek te maken. De zichtbaarheid blijft een concrete keuze bij jouw project.
            </p>
          </div>

          <div className="border-t border-border lg:col-span-6 lg:col-start-7">
            {PRIVACY_LEVELS.map(({ level, title, description }) => (
              <div key={level} className="grid gap-3 border-b border-border py-5 sm:grid-cols-[8rem_1fr] sm:gap-6">
                <PrivacyBadge level={level} className="w-fit self-start" />
                <div>
                  <h3 className="font-sans text-base font-semibold">{title}</h3>
                  <p className="mt-1 font-sans text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
          </section>

          <section className="border-b border-border" aria-labelledby="book-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 md:px-8 md:py-24 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-5">
            <SectionLabel>Van scherm naar papier</SectionLabel>
            <h2 id="book-title" className="max-w-lg font-serif text-4xl leading-[1.02] md:text-5xl">
              Jouw verbouwing als echt Bouwboek.
            </h2>
            <p className="mt-5 max-w-xl font-sans text-base leading-7 text-muted-foreground">
              Foto’s, updates en mijlpalen vallen vanzelf op hun plek. Jij bekijkt de printproof, kiest wat meegaat en bestelt pas wanneer het boek klopt.
            </p>
            <Button asChild variant="outline" size="lg" className="mt-7 min-h-12 rounded-md px-6">
              <Link to={user ? PRODUCT_ROUTES.newProject : "/auth?mode=register&next=%2Fproject%2Fnieuw"}>
                Bouw aan je eigen boek <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <div className="lg:col-span-7">
            <BookPreview project={bookProject} />
          </div>
        </div>
          </section>
        </>
      ) : null}

      <section id="projecten" className="scroll-mt-24" aria-labelledby="projects-title">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:px-8 md:py-24">
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <SectionLabel>{view === "projects" ? "Jouw bouwdagboeken" : "Ontdekken"}</SectionLabel>
              <ProjectHeading id="projects-title" className="max-w-2xl font-serif text-4xl leading-[1.02] md:text-5xl">
                {view === "projects" ? "Mijn projecten." : "Openbare bouwverhalen, bewust gedeeld."}
              </ProjectHeading>
            </div>
            <p className="max-w-xl font-sans text-sm leading-6 text-muted-foreground lg:col-span-4 lg:col-start-9 lg:pt-7 md:text-base md:leading-7">
              {view === "projects"
                ? "Hier staan alleen projecten die bij jouw account horen. Start een update of open een project om verder te bouwen."
                : "Hier staan uitsluitend projecten die hun maker openbaar heeft gezet. Privé- en gedeelde projecten horen nooit in deze selectie."}
            </p>
          </div>

          {!isLanding ? (
            <nav className="mt-10 flex items-center gap-8 border-b border-border" aria-label="Projectoverzicht">
            <Link
              id="discover-tab"
              to={PRODUCT_ROUTES.discover}
              aria-current={tab === "discover" ? "page" : undefined}
              className={`relative min-h-12 rounded-sm px-1 font-sans text-xs font-semibold uppercase tracking-[0.16em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 ${
                tab === "discover" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Ontdekken
              {tab === "discover" ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" aria-hidden="true" /> : null}
            </Link>
            {user ? (
              <Link
                id="mine-tab"
                to={PRODUCT_ROUTES.projects}
                aria-current={tab === "mine" ? "page" : undefined}
                className={`relative min-h-12 rounded-sm px-1 font-sans text-xs font-semibold uppercase tracking-[0.16em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 ${
                  tab === "mine" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Mijn projecten
                {tab === "mine" ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" aria-hidden="true" /> : null}
              </Link>
            ) : null}
            </nav>
          ) : null}

          {tab === "discover" ? (
            <div id="discover-panel" className="outline-none">
              <div className="my-10 grid gap-4 border-b border-border pb-8 md:grid-cols-[minmax(0,1fr)_18rem]">
                <label className="block">
                  <span className="mb-2 block font-sans text-xs font-semibold text-foreground">Zoek in openbare projecten</span>
                  <span className="relative block">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Projectnaam of maker"
                      className="h-12 w-full rounded-md border border-input bg-background pl-10 pr-12 font-sans text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    {search ? (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        aria-label="Zoekopdracht wissen"
                        className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 block font-sans text-xs font-semibold text-foreground">Type project</span>
                  <select
                    value={selectedType}
                    onChange={(event) => setSelectedType(event.target.value)}
                    className="h-12 w-full rounded-md border border-input bg-background px-3 font-sans text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Alle typen</option>
                    {activeTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
              </div>

              {loadingDiscover ? (
                <ProjectCollection projects={[]} loading emptyState={null} />
              ) : discoverError ? (
                <AsyncState
                  status="error"
                  title="Openbare projecten zijn even niet bereikbaar"
                  description="We tonen geen projectgegevens totdat de openbare selectie veilig kon worden gecontroleerd. Probeer het opnieuw."
                  action={<Button variant="outline" onClick={() => void discoveryQuery.refetch()}>Opnieuw proberen</Button>}
                />
              ) : filtered.length === 0 ? (
                <AsyncState
                  status="empty"
                  title={search || selectedType ? "Geen openbare projecten gevonden" : "Nog geen publieke projecten"}
                  description={search || selectedType
                    ? "Pas je zoekopdracht of projecttype aan."
                    : "Zodra iemand een project bewust openbaar deelt, verschijnt het hier."}
                  action={search || selectedType ? <Button variant="outline" onClick={clearFilters}>Wis filters</Button> : undefined}
                />
              ) : (
                <div className="space-y-20" aria-live="polite">
                  <p className="sr-only">{filtered.length} openbare {filtered.length === 1 ? "project" : "projecten"} gevonden.</p>
                  {renderProjectSection("Actieve bouwverhalen", active)}
                  {renderProjectSection("Net begonnen", recentlyStarted)}
                  {renderProjectSection("Bijna klaar", nearlyFinished)}
                  {renderProjectSection("Meer bouwverhalen", moreProjects)}
                  {discoveryQuery.hasNextPage ? (
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={discoveryQuery.isFetchingNextPage}
                        onClick={() => void discoveryQuery.fetchNextPage()}
                      >
                        {discoveryQuery.isFetchingNextPage ? "Projecten laden…" : "Meer projecten laden"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {tab === "mine" && user ? (
            <div id="mine-panel" className="pt-10 outline-none">
              {loadingMine ? (
                <ProjectCollection projects={[]} loading emptyState={null} />
              ) : mineError ? (
                <AsyncState
                  status="error"
                  title="Je projecten zijn even niet bereikbaar"
                  description="We tonen geen eerder geladen privégegevens. Controleer je verbinding en probeer het opnieuw."
                  action={<Button variant="outline" onClick={() => void dashboardQuery.refetch()}>Opnieuw proberen</Button>}
                />
              ) : (
                <ProjectCollection
                  projects={mine}
                  loading={false}
                  emptyState={(
                    <AsyncState
                      status="empty"
                      title="Begin je eerste verbouwing"
                      description="Documenteer iedere fase en bepaal daarna rustig wie mag meekijken."
                      action={(
                        <Button asChild>
                          <Link to={PRODUCT_ROUTES.newProject}><Plus className="h-4 w-4" aria-hidden="true" /> Nieuw project</Link>
                        </Button>
                      )}
                    />
                  )}
                />
              )}
              {!loadingMine && !mineError && dashboardQuery.hasNextPage ? (
                <div className="mt-12 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={dashboardQuery.isFetchingNextPage}
                    onClick={() => void dashboardQuery.fetchNextPage()}
                  >
                    {dashboardQuery.isFetchingNextPage ? "Projecten laden…" : "Meer projecten laden"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {isLanding && !user ? (
        <section className="border-t border-border bg-foreground text-background" aria-labelledby="final-cta-title">
          <div className="mx-auto grid max-w-7xl items-end gap-8 px-4 py-14 sm:px-6 md:px-8 md:py-16 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-background/65">Jouw eerste veldnotitie</p>
              <h2 id="final-cta-title" className="mt-3 max-w-3xl font-serif text-4xl leading-[1.02] md:text-5xl">
                Vandaag één update. Straks het hele verhaal.
              </h2>
              <p className="mt-4 max-w-xl font-sans text-sm leading-6 text-background/70">Gratis beginnen, privé bewaren en pas delen wanneer jij daar klaar voor bent.</p>
            </div>
            <div className="lg:col-span-4 lg:flex lg:justify-end">
              <Button asChild size="lg" className="min-h-12 w-full rounded-md bg-background px-6 text-foreground hover:bg-background/90 sm:w-auto">
                <Link to="/auth?mode=register&next=%2Fproject%2Fnieuw">
                  Maak je eerste project <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default Index;
