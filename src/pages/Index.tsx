import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Camera,
  Eye,
  MessageCircle,
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
import LocalPhotoDemo, { LOCAL_PHOTO_AUTH_PATH } from "@/components/landing/LocalPhotoDemo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useProjectDashboard, useProjectDiscovery } from "@/hooks/useProjectApi";
import { authPagePath } from "@/lib/authClient";
import { LANDING_PHOTO_INTENT } from "@/lib/landingPhotoHandoffStore";
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
    title: "Bewaar ieder bouwmoment",
    description: "Een foto en een paar woorden worden een rustig hoofdstuk in je Verhaal.",
  },
  {
    icon: Users,
    title: "Beleef het samen",
    description: "Laat familie en vrienden gericht volgen, reageren en later opnieuw terugkijken.",
  },
  {
    icon: BookOpen,
    title: "Zie je Bouwboek groeien",
    description: "Elk Bouwmoment krijgt vanzelf een plek in een persoonlijk boek voor later.",
  },
];

const PRIVACY_LEVELS = [
  {
    level: "private" as const,
    title: "Privé als vertrekpunt",
    description: "Kies per verbouwing: alleen jij, je profielvolgers, iedereen met de link of volledig openbaar.",
  },
  {
    level: "shared" as const,
    title: "Gedeeld met jouw kring",
    description: "Nodig gericht vrienden of familie uit om mee te kijken.",
  },
  {
    level: "public" as const,
    title: "Openbaar als bewuste keuze",
    description: "Alleen dan kan je Verhaal in Ontdekken verschijnen. Adres, budget en werkaantekeningen horen daar nooit automatisch bij.",
  },
];

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
        aria-label="Verbouwingen laden"
      >
        <ProjectSkeleton feature />
        <ProjectSkeleton />
        <span className="sr-only">Verbouwingen laden…</span>
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
                  visibility={project.visibility}
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

const ExampleRenovation = () => (
  <figure className="border-y border-[#D8CFC1] bg-[#FFFDF8]">
    <figcaption className="flex min-h-12 flex-col items-start justify-center gap-1 border-b border-[#D8CFC1] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#655F57] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
      <span className="text-[#A94E36]">Voorbeeldverbouwing</span>
      <span>Volgerweergave</span>
    </figcaption>
    <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
      <div className="relative overflow-hidden border-b border-[#D8CFC1] bg-[#F7F2E9] p-5 sm:p-8 lg:border-b-0 lg:border-r">
        <div className="buildy-crop-frame relative min-h-72 border border-[#D8CFC1] bg-[#D8CFC1] p-6 sm:min-h-80 sm:p-8">
          <div className="absolute inset-x-[18%] bottom-0 top-[28%] border-x-2 border-t-2 border-[#655F57]/55" aria-hidden="true" />
          <div className="absolute left-[12%] right-[12%] top-[28%] h-0.5 -rotate-[17deg] bg-[#655F57]/55" aria-hidden="true" />
          <div className="absolute left-1/2 top-[28%] h-[72%] w-0.5 bg-[#655F57]/45" aria-hidden="true" />
          <div className="relative z-10 flex h-full min-h-56 items-end">
            <div className="max-w-xs bg-[#FFFDF8]/95 p-4 shadow-[0_8px_24px_rgba(38,35,31,0.08)]">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Bouwmoment · Vandaag</p>
              <p className="mt-2 font-serif text-3xl leading-none text-[#26231F]">Meer licht aan de achterkant.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#655F57]">In het Verhaal</p>
        <ol className="mt-5 space-y-5 border-l border-[#D8CFC1] pl-5">
          <li>
            <p className="text-xs text-[#655F57]">Hoofdstuk 01</p>
            <p className="mt-1 font-semibold text-[#26231F]">De eerste plannen</p>
          </li>
          <li className="relative before:absolute before:-left-[1.38rem] before:top-1 before:h-2.5 before:w-2.5 before:rounded-full before:bg-[#A94E36]">
            <p className="text-xs text-[#655F57]">Hoofdstuk 02</p>
            <p className="mt-1 font-semibold text-[#26231F]">Meer daglicht</p>
          </li>
        </ol>
        <div className="mt-8 border-t border-[#D8CFC1] pt-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#26231F]">
            <Eye className="h-4 w-4 text-[#A94E36]" aria-hidden="true" /> Gericht meekijken
          </p>
          <p className="mt-2 text-sm leading-6 text-[#655F57]">Jij kiest per verbouwing wie gepubliceerde Bouwmomenten kan zien.</p>
          <div className="mt-4 flex min-h-11 items-center gap-3 border border-[#D8CFC1] px-3 text-sm text-[#655F57]">
            <MessageCircle className="h-4 w-4" aria-hidden="true" /> Reacties blijven bij het juiste Bouwmoment.
          </div>
        </div>
      </div>
    </div>
  </figure>
);

const ExampleBookSpread = () => (
  <figure>
    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Voorbeeldverbouwing</div>
    <div className="buildy-book-binding grid aspect-[8/5] w-full grid-cols-2 border border-[#D8CFC1] bg-[#FFFDF8] p-3 shadow-[0_16px_36px_rgba(38,35,31,0.10)] sm:p-5">
      <div className="flex flex-col justify-between border-r border-[#D8CFC1] p-3 sm:p-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#A94E36] sm:text-xs">Hoofdstuk 04</p>
          <p className="mt-3 font-serif text-2xl leading-none text-[#26231F] sm:text-4xl">Ruimte voor het nieuwe.</p>
        </div>
        <p className="text-[10px] text-[#655F57] sm:text-xs">Een Bouwboek groeit mee met het Verhaal.</p>
      </div>
      <div className="buildy-crop-frame relative m-2 overflow-hidden bg-[#D8CFC1] sm:m-4">
        <div className="absolute inset-x-[16%] bottom-0 top-[25%] border-x border-t border-[#655F57]/50" aria-hidden="true" />
        <div className="absolute left-[10%] right-[10%] top-[25%] h-px -rotate-[18deg] bg-[#655F57]/50" aria-hidden="true" />
      </div>
    </div>
  </figure>
);

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">{children}</p>
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
  usePageMeta({
    title: view === "projects"
      ? "Mijn verbouwingen — Buildy"
      : view === "discover"
        ? "Ontdek verbouwingen — Buildy"
        : "Buildy — Maak van je verbouwing een verhaal om te bewaren",
    description: view === "projects"
      ? "Bekijk en beheer je eigen verbouwingen."
      : view === "discover"
        ? "Ontdek openbare Verhalen die hun makers bewust delen."
        : "Leg ieder bouwmoment vast, laat vrienden en familie meekijken en maak er later een persoonlijk Bouwboek van.",
    path: view === "projects"
      ? PRODUCT_ROUTES.projects
      : view === "discover"
        ? PRODUCT_ROUTES.discover
        : PRODUCT_ROUTES.landing,
    noIndex: view === "projects",
  });

  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const discoveryQuery = useProjectDiscovery(view === "discover");
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
          <section className="border-b border-[#D8CFC1]" aria-labelledby="home-title">
            <div className="mx-auto grid max-w-7xl gap-12 px-4 py-12 sm:px-6 md:px-8 md:py-16 lg:grid-cols-12 lg:items-center lg:gap-10 lg:py-20">
              <div className="lg:col-span-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Het dagboek voor je verbouwing</p>
                <h1 id="home-title" className="mt-5 max-w-3xl font-serif text-5xl leading-[0.92] tracking-[-0.025em] text-[#26231F] sm:text-6xl lg:text-7xl">
                  Maak van je verbouwing een verhaal om te bewaren.
                </h1>
                <p className="mt-7 max-w-xl text-base leading-7 text-[#655F57] md:text-lg md:leading-8">
                  Leg ieder bouwmoment vast, laat vrienden en familie meekijken en maak er later een persoonlijk Bouwboek van.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="min-h-12 w-full bg-[#A94E36] px-6 text-white hover:bg-[#8F3F2C] sm:w-auto">
                    <a href="#probeer-buildy">Voeg je eerste verbouwfoto toe</a>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="min-h-12 w-full border-[#D8CFC1] bg-transparent px-6 text-[#26231F] hover:bg-[#FFFDF8] hover:text-[#26231F] sm:w-auto">
                    <a href="#voorbeeld">Bekijk een voorbeeld</a>
                  </Button>
                </div>
                <aside className="mt-8 flex max-w-xl items-start gap-3 border-l-2 border-[#A94E36] pl-4" aria-label="Privacybelofte">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#A94E36]" aria-hidden="true" />
                  <p className="text-sm leading-6 text-[#655F57]">Je begint privé en kiest zelf wie ieder Bouwmoment kan zien.</p>
                </aside>
              </div>
              <div className="min-w-0 lg:col-span-7">
                <LocalPhotoDemo saveHref={user ? `${PRODUCT_ROUTES.newProject}?intent=${LANDING_PHOTO_INTENT}` : LOCAL_PHOTO_AUTH_PATH} />
              </div>
            </div>
          </section>

          <section id="voorbeeld" className="scroll-mt-28 border-b border-[#D8CFC1]" aria-labelledby="example-title">
            <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:px-8 md:py-24">
              <div className="mb-10 grid gap-5 lg:grid-cols-12">
                <div className="lg:col-span-6">
                  <SectionLabel>Bekijk het product</SectionLabel>
                  <h2 id="example-title" className="max-w-2xl font-serif text-4xl leading-none text-[#26231F] md:text-5xl">
                    Eén Bouwmoment, precies waar het thuishoort.
                  </h2>
                </div>
                <p className="max-w-xl text-base leading-7 text-[#655F57] lg:col-span-4 lg:col-start-9 lg:pt-6">
                  Dit is een duidelijk gemarkeerde productweergave—geen testimonial, gebruikersprofiel of verzonnen reactie.
                </p>
              </div>
              <ExampleRenovation />
            </div>
          </section>

          <section id="zo-werkt-het" className="scroll-mt-28 border-b border-[#D8CFC1]" aria-labelledby="how-title">
            <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:px-8 md:py-20">
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-5">
                  <SectionLabel>Drie uitkomsten</SectionLabel>
                  <h2 id="how-title" className="max-w-lg font-serif text-4xl leading-none text-[#26231F] md:text-5xl">
                    Van de klus van vandaag naar iets voor later.
                  </h2>
                </div>
                <p className="max-w-2xl text-base leading-7 text-[#655F57] lg:col-span-5 lg:col-start-8 lg:pt-6">
                  Geen losse fotomap en geen projectmanagementsysteem. Buildy geeft elk moment context en bewaart de lijn door je hele verbouwing.
                </p>
              </div>

              <ol className="mt-12 border-y border-[#D8CFC1] md:grid md:grid-cols-3">
                {CORE_STEPS.map(({ icon: Icon, title, description }, index) => (
                  <li key={title} className="grid grid-cols-[3rem_1fr] gap-4 border-b border-[#D8CFC1] py-7 last:border-b-0 md:block md:border-b-0 md:border-r md:px-7 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
                    <div className="flex items-center justify-between md:mb-10">
                      <span className="text-xs font-semibold tabular-nums text-[#A94E36]">0{index + 1}</span>
                      <Icon className="hidden h-5 w-5 text-[#655F57] md:block" strokeWidth={1.5} aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold tracking-[-0.02em] text-[#26231F]">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[#655F57]">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="border-b border-[#D8CFC1] bg-[#FFFDF8]" aria-labelledby="following-title">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:px-8 md:py-20 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <SectionLabel>Samen volgen</SectionLabel>
                <h2 id="following-title" className="max-w-lg font-serif text-4xl leading-none text-[#26231F] md:text-5xl">
                  Delen zonder steeds hetzelfde verhaal te vertellen.
                </h2>
              </div>
              <ol className="border-t border-[#D8CFC1] lg:col-span-6 lg:col-start-7">
                {[
                  ["Nodig gericht uit", "Jij kiest wie je verbouwing kan volgen."],
                  ["Publiceer een Bouwmoment", "Het verschijnt chronologisch in het Verhaal."],
                  ["Praat op de juiste plek", "Reacties blijven verbonden aan het moment waarop ze horen."],
                ].map(([title, description], index) => (
                  <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-[#D8CFC1] py-5">
                    <span className="text-xs font-semibold tabular-nums text-[#A94E36]">0{index + 1}</span>
                    <div>
                      <h3 className="font-semibold text-[#26231F]">{title}</h3>
                      <p className="mt-1 text-sm leading-6 text-[#655F57]">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="border-b border-[#D8CFC1] bg-[#F7F2E9]" aria-labelledby="privacy-title">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:px-8 md:py-20 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <SectionLabel>Privacy zonder kleine lettertjes</SectionLabel>
                <h2 id="privacy-title" className="max-w-lg font-serif text-4xl leading-none text-[#26231F] md:text-5xl">
                  Jouw huis hoeft niet voor iedereen open te staan.
                </h2>
                <p className="mt-5 max-w-xl text-sm leading-6 text-[#655F57] md:text-base md:leading-7">
                  Je kunt delen zonder alles publiek te maken. De zichtbaarheid blijft een concrete keuze bij jouw verbouwing.
                </p>
              </div>

              <div className="border-t border-[#D8CFC1] lg:col-span-6 lg:col-start-7">
                {PRIVACY_LEVELS.map(({ level, title, description }) => (
                  <div key={level} className="grid gap-3 border-b border-[#D8CFC1] py-5 sm:grid-cols-[8rem_1fr] sm:gap-6">
                    <PrivacyBadge level={level} className="w-fit self-start" />
                    <div>
                      <h3 className="text-base font-semibold text-[#26231F]">{title}</h3>
                      <p className="mt-1 text-sm leading-6 text-[#655F57]">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="border-b border-[#D8CFC1]" aria-labelledby="book-title">
            <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 md:px-8 md:py-24 lg:grid-cols-12 lg:gap-10">
              <div className="lg:col-span-5">
                <SectionLabel>Van scherm naar papier</SectionLabel>
                <h2 id="book-title" className="max-w-lg font-serif text-4xl leading-none text-[#26231F] md:text-5xl">
                  Je Bouwboek groeit terwijl jij verder bouwt.
                </h2>
                <p className="mt-5 max-w-xl text-base leading-7 text-[#655F57]">
                  Foto’s, Bouwmomenten en mijlpalen krijgen vanzelf een plek. Jij houdt de regie over wat later in het boek komt.
                </p>
                <Button asChild variant="outline" size="lg" className="mt-7 min-h-12 border-[#A94E36] bg-transparent px-6 text-[#26231F] hover:bg-[#A94E36] hover:text-white">
                  <a href="#probeer-buildy">Voeg je eerste verbouwfoto toe <ArrowRight aria-hidden="true" /></a>
                </Button>
              </div>
              <div className="lg:col-span-7">
                <ExampleBookSpread />
              </div>
            </div>
          </section>

          <section className="border-b border-[#D8CFC1] bg-[#FFFDF8]" aria-labelledby="faq-title">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:px-8 md:py-20 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <SectionLabel>Veelgestelde vragen</SectionLabel>
                <h2 id="faq-title" className="font-serif text-4xl leading-none text-[#26231F] md:text-5xl">Eerst weten, dan bewaren.</h2>
              </div>
              <div className="border-t border-[#D8CFC1] lg:col-span-7 lg:col-start-6">
                {[
                  ["Wordt mijn foto in het voorbeeld geüpload?", "Nee. De voorvertoning wordt alleen in je browser gemaakt en verlaat je apparaat niet."],
                  ["Is mijn verbouwing meteen openbaar?", "Nee. Een nieuwe verbouwing begint privé. Jij kiest later bewust wie mag meekijken."],
                  ["Moet ik mijn Bouwboek zelf opmaken?", "Nee. Het Bouwboek groeit vanuit je Bouwmomenten; jij kiest welke momenten je wilt bewaren."],
                ].map(([question, answer]) => (
                  <details key={question} className="group border-b border-[#D8CFC1]">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-[#26231F] outline-none focus-visible:ring-2 focus-visible:ring-[#A94E36] focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                      {question}
                      <span className="text-xl font-normal text-[#A94E36] transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden="true">+</span>
                    </summary>
                    <p className="max-w-2xl pb-5 text-sm leading-6 text-[#655F57]">{answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {!isLanding ? (
      <section id="verbouwingen" className="scroll-mt-24" aria-labelledby="projects-title">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:px-8 md:py-24">
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <SectionLabel>{view === "projects" ? "Jouw Bouwdagboeken" : "Ontdek verbouwingen"}</SectionLabel>
              <h1 id="projects-title" className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-[-0.03em] md:text-5xl">
                {view === "projects" ? "Mijn verbouwingen" : "Openbare Verhalen, bewust gedeeld"}
              </h1>
            </div>
            <p className="max-w-xl font-sans text-sm leading-6 text-muted-foreground lg:col-span-4 lg:col-start-9 lg:pt-7 md:text-base md:leading-7">
              {view === "projects"
                ? "Hier staan alleen verbouwingen die bij jouw account horen. Voeg een Bouwmoment toe of open een Verhaal om verder te gaan."
                : "Hier staan uitsluitend verbouwingen die hun maker openbaar heeft gezet. Privé- en gedeelde Verhalen horen nooit in deze selectie."}
            </p>
          </div>

            <nav className="mt-10 flex items-center gap-8 border-b border-border" aria-label="Verbouwingsoverzicht">
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
                Mijn verbouwingen
                {tab === "mine" ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" aria-hidden="true" /> : null}
              </Link>
            ) : null}
            </nav>

          {tab === "discover" ? (
            <div id="discover-panel" className="outline-none">
              <div className="my-10 grid gap-4 border-b border-border pb-8 md:grid-cols-[minmax(0,1fr)_18rem]">
                <label className="block">
                  <span className="mb-2 block font-sans text-xs font-semibold text-foreground">Zoek in openbare verbouwingen</span>
                  <span className="relative block">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Naam van verbouwing of maker"
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
                  <span className="mb-2 block font-sans text-xs font-semibold text-foreground">Type verbouwing</span>
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
                  title="Openbare verbouwingen zijn even niet bereikbaar"
                  description="We tonen geen verbouwingen totdat de openbare selectie veilig kon worden gecontroleerd. Probeer het opnieuw."
                  action={<Button variant="outline" onClick={() => void discoveryQuery.refetch()}>Opnieuw proberen</Button>}
                />
              ) : filtered.length === 0 ? (
                <AsyncState
                  status="empty"
                  title={search || selectedType ? "Geen openbare verbouwingen gevonden" : "Nog geen openbare verbouwingen"}
                  description={search || selectedType
                    ? "Pas je zoekopdracht of verbouwingstype aan."
                    : "Zodra iemand een Verhaal bewust openbaar deelt, verschijnt het hier."}
                  action={search || selectedType ? <Button variant="outline" onClick={clearFilters}>Wis filters</Button> : undefined}
                />
              ) : (
                <div className="space-y-20" aria-live="polite">
                  <p className="sr-only">{filtered.length} openbare {filtered.length === 1 ? "verbouwing" : "verbouwingen"} gevonden.</p>
                  {renderProjectSection("Actieve Verhalen", active)}
                  {renderProjectSection("Net begonnen", recentlyStarted)}
                  {renderProjectSection("Bijna klaar", nearlyFinished)}
                  {renderProjectSection("Meer Verhalen", moreProjects)}
                  {discoveryQuery.hasNextPage ? (
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={discoveryQuery.isFetchingNextPage}
                        onClick={() => void discoveryQuery.fetchNextPage()}
                      >
                        {discoveryQuery.isFetchingNextPage ? "Verbouwingen laden…" : "Meer verbouwingen laden"}
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
                  title="Je verbouwingen zijn even niet bereikbaar"
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
                          <Link to={PRODUCT_ROUTES.newProject}><Plus className="h-4 w-4" aria-hidden="true" /> Nieuwe verbouwing</Link>
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
                    {dashboardQuery.isFetchingNextPage ? "Verbouwingen laden…" : "Meer verbouwingen laden"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {isLanding && !user ? (
        <section className="border-t border-[#D8CFC1] bg-[#26231F] text-[#F7F2E9]" aria-labelledby="final-cta-title">
          <div className="mx-auto grid max-w-7xl items-end gap-8 px-4 py-14 sm:px-6 md:px-8 md:py-16 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#D8CFC1]">Je eerste Bouwmoment</p>
              <h2 id="final-cta-title" className="mt-3 max-w-3xl font-serif text-4xl leading-[1.02] md:text-5xl">
                Vandaag één foto. Straks een heel Verhaal.
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#D8CFC1]">Probeer het op dit apparaat, begin privé en deel pas wanneer jij daar klaar voor bent.</p>
            </div>
            <div className="lg:col-span-4 lg:flex lg:justify-end">
              <Button asChild size="lg" className="min-h-12 w-full bg-[#A94E36] px-6 text-white hover:bg-[#8F3F2C] sm:w-auto">
                <a href="#probeer-buildy">
                  Voeg je eerste verbouwfoto toe <ArrowRight aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default Index;
