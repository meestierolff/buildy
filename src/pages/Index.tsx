import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Camera,
  Eye,
  Heart,
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
import {
  PUBLIC_DEMO_EXAMPLE_BOOK_PATH,
  PUBLIC_DEMO_EXAMPLE_PROJECT_PATH,
} from "@/lib/publicDemo";
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
    title: "Vastleggen",
    description: "Voeg foto’s en een korte update toe.",
  },
  {
    icon: Users,
    title: "Samen beleven",
    description: "Deel je verbouwing met vrienden en familie.",
  },
  {
    icon: BookOpen,
    title: "Bewaren",
    description: "Zie automatisch een persoonlijk Bouwboek ontstaan.",
  },
];

const PUBLIC_DEMO_STEPS: Principle[] = [
  {
    icon: Camera,
    title: "Foto",
    description: "Kies één verbouwfoto op je apparaat.",
  },
  {
    icon: Plus,
    title: "Bouwmoment",
    description: "Zie de foto met een plek en een moment.",
  },
  {
    icon: ArrowRight,
    title: "Verhaal",
    description: "Plaats Bouwmomenten in een rustige tijdlijn.",
  },
  {
    icon: BookOpen,
    title: "Bouwboek",
    description: "Bekijk dezelfde herinnering als boekspread.",
  },
];

const PRIVACY_LEVELS = [
  {
    level: "private" as const,
    title: "Alleen ik",
    description: "De standaard. Alleen jij ziet je verbouwing totdat je bewust gaat delen.",
  },
  {
    level: "shared" as const,
    title: "Iedereen met de link",
    description: "Vrienden en familie kijken mee via een beveiligde link die je weer kunt intrekken.",
  },
  {
    level: "public" as const,
    title: "Openbaar",
    description: "Alleen als jij dat kiest, kan iedereen je gepubliceerde Verhaal bekijken.",
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

const ExampleRenovation = ({ publicDemo = false }: { publicDemo?: boolean }) => (
  <figure className="overflow-hidden rounded-[1.5rem] border border-[#D8CFC1] bg-[#FFFDF8] shadow-[0_24px_70px_rgba(38,35,31,0.08)]">
    <figcaption className="flex min-h-12 items-center justify-between gap-4 border-b border-[#D8CFC1] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#655F57] sm:px-6">
      <span className="text-[#A94E36]">{publicDemo ? "Voorbeeldverbouwing" : "Volgerweergave"}</span>
      <span>{publicDemo ? "Volledig verzonnen demo" : "De benedenverdieping"}</span>
    </figcaption>
    <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
      <img
        src="/images/buildy-renovation-progress.webp"
        alt="Een Nederlandse benedenverdieping tijdens de verbouwing"
        className="aspect-[4/3] h-full w-full object-cover lg:aspect-auto"
      />
      <div className="flex flex-col p-5 sm:p-8">
        {publicDemo ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Chronologisch Verhaal</p>
            <h3 className="mt-3 font-serif text-4xl leading-[0.95] text-[#26231F]">De benedenverdieping</h3>
            <ol className="relative mt-6 space-y-5 pl-5 before:absolute before:bottom-2 before:left-1 before:top-2 before:w-px before:bg-[#D8CFC1]" aria-label="Voorbeeld Bouwmomenten">
              {[
                ["6 april", "De oude keuken is eruit."],
                ["12 mei", "De achtergevel is open."],
                ["28 juni", "We wonen weer beneden."],
              ].map(([date, title], index) => (
                <li key={date} className="relative before:absolute before:-left-[1.28rem] before:top-1.5 before:h-2.5 before:w-2.5 before:rounded-full before:bg-[#A94E36]">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A94E36]">Bouwmoment {index + 1} · {date}</p>
                  <p className="mt-1 text-sm font-semibold text-[#26231F]">{title}</p>
                </li>
              ))}
            </ol>
            <div className="mt-auto pt-8">
              <div className="border-t border-[#D8CFC1] pt-4">
                <p className="flex items-start gap-2 text-xs leading-5 text-[#655F57]">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#A94E36]" aria-hidden="true" />
                  <span><strong className="text-[#26231F]">Voorbeeldreactie · demonstratie:</strong> “Wat een verschil.” Geen echte gebruikersactiviteit.</span>
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Bouwmoment · 12 mei</p>
            <h3 className="mt-3 font-serif text-4xl leading-[0.95] text-[#26231F]">De achtergevel is open.</h3>
            <p className="mt-5 text-sm leading-6 text-[#655F57]">
              Na weken slopen komt er eindelijk daglicht binnen. Vandaag stond het nieuwe houten frame.
            </p>
            <div className="mt-auto pt-8">
              <div className="border-t border-[#D8CFC1] pt-4">
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#D8CFC1] px-3 text-sm text-[#26231F]">
                    <Heart className="h-4 w-4 text-[#A94E36]" aria-hidden="true" /> 8 reacties
                  </span>
                  <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#D8CFC1] px-3 text-sm text-[#26231F]">
                    <MessageCircle className="h-4 w-4" aria-hidden="true" /> 3 opmerkingen
                  </span>
                </div>
                <p className="mt-4 flex items-center gap-2 text-xs leading-5 text-[#655F57]">
                  <Eye className="h-4 w-4 text-[#A94E36]" aria-hidden="true" /> Alleen kijken; de eigenaar houdt de regie.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  </figure>
);

const ExampleBookSpread = () => (
  <figure>
    <div className="overflow-hidden rounded-[1.5rem] border border-[#D8CFC1] bg-[#FFFDF8] shadow-[0_24px_70px_rgba(38,35,31,0.12)]">
      <img
        src="/images/buildy-bouwboek-preview.webp"
        alt="Voorbeeld van een open Buildy Bouwboek met dezelfde kamer tijdens en na de verbouwing"
        className="aspect-[3/2] w-full object-cover"
      />
    </div>
  </figure>
);

const HeroProductPreview = ({ publicDemo = false }: { publicDemo?: boolean }) => (
  <div className="relative mx-auto w-full max-w-[34rem] lg:ml-auto">
    <div className="overflow-hidden rounded-[1.6rem] border border-white/30 bg-[#FFFDF8] shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
      <div className="flex h-11 items-center justify-between border-b border-[#D8CFC1] px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#655F57]">
        <span>De benedenverdieping</span>
        <span className="text-[#A94E36]">{publicDemo ? "Voorbeeld" : "Alleen ik"}</span>
      </div>
      <img
        src="/images/buildy-renovation-complete.webp"
        alt="Buildy-productvoorbeeld met een afgeronde Nederlandse woonkamerverbouwing"
        className="aspect-[16/10] w-full object-cover"
      />
      <div className="grid grid-cols-[1.2rem_1fr] gap-3 px-4 py-4 sm:px-5">
        <span className="relative mt-1 h-full min-h-16 before:absolute before:bottom-0 before:left-[5px] before:top-2 before:w-px before:bg-[#D8CFC1] after:absolute after:left-0 after:top-1 after:h-3 after:w-3 after:rounded-full after:bg-[#A94E36]" aria-hidden="true" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Bouwmoment · Vandaag</p>
          <p className="mt-1 font-serif text-2xl leading-none text-[#26231F]">We wonen weer beneden.</p>
          {publicDemo ? (
            <p className="mt-2 text-xs font-semibold text-[#655F57]">Foto → Bouwmoment → Verhaal → Bouwboek</p>
          ) : (
            <p className="mt-2 flex items-center gap-3 text-xs text-[#655F57]"><Heart className="h-3.5 w-3.5" aria-hidden="true" /> 8 <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> 3</p>
          )}
        </div>
      </div>
    </div>
    <div className="absolute -bottom-5 -left-3 rounded-full border border-white/25 bg-[#26231F] px-4 py-2 text-xs font-semibold text-white shadow-lg sm:-left-8">
      Je Bouwboek groeit mee
    </div>
  </div>
);

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">{children}</p>
);

const Index = ({
  feedbackEnabled = false,
  publicDemo = false,
}: {
  feedbackEnabled?: boolean;
  publicDemo?: boolean;
}) => {
  const { user, loading: authLoading } = useAuth();
  const { hash, pathname } = useLocation();
  const view = pathname === PRODUCT_ROUTES.projects
    ? "projects"
    : pathname === PRODUCT_ROUTES.discover
      ? "discover"
      : "landing";
  const tab: ProjectTab = view === "projects" ? "mine" : "discover";
  const isLanding = view === "landing";
  useEffect(() => {
    if (!publicDemo || !isLanding) return undefined;
    const targetId = hash.slice(1);
    if (!["zo-werkt-het", "voorbeeld", "probeer-buildy"].includes(targetId)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, isLanding, publicDemo]);
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
        : publicDemo
          ? "Zie hoe losse bouwfoto’s veranderen in een rustig verbouwverhaal en een persoonlijk Bouwboek."
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
      <main className="flex min-h-[55vh] items-center justify-center" role="status">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-hidden="true" />
        <span className="sr-only">Account controleren…</span>
      </main>
    );
  }

  if (view === "projects" && !user) {
    return <Navigate to={authPagePath(PRODUCT_ROUTES.projects)} replace />;
  }

  return (
    <main className="min-h-screen bg-background">
      {isLanding ? (
        <>
          <section className="relative isolate overflow-hidden bg-[#26231F] text-white" aria-labelledby="home-title">
            <img
              src="/images/buildy-renovation-progress.webp"
              alt="Een Nederlandse woning tijdens een lichte, hoopvolle verbouwing"
              className="absolute inset-0 -z-20 h-full w-full object-cover object-center"
            />
            <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(25,22,19,0.92)_0%,rgba(25,22,19,0.74)_45%,rgba(25,22,19,0.2)_100%)]" aria-hidden="true" />
            <div className="mx-auto grid min-h-[calc(100svh-4.5rem)] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 md:px-8 lg:grid-cols-12 lg:gap-10 lg:py-20">
              <div className="lg:col-span-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E0A998]">
                  {publicDemo ? "Het dagboek voor je verbouwing" : "Van bouwplaats naar blijvend verhaal"}
                </p>
                <h1 id="home-title" className="mt-5 max-w-[10ch] font-serif text-[clamp(3.25rem,7vw,6.6rem)] leading-[0.88] tracking-[-0.035em] text-white">
                  Maak van je verbouwing een verhaal om te bewaren.
                </h1>
                <p className="mt-7 max-w-xl text-base leading-7 text-white/80 md:text-lg md:leading-8">
                  {publicDemo
                    ? "Zie hoe losse bouwfoto’s veranderen in een rustig verbouwverhaal en een persoonlijk Bouwboek."
                    : "Leg foto’s en updates vast, laat vrienden en familie meekijken en maak er na afloop een persoonlijk Bouwboek van."}
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="min-h-12 w-full bg-[#A94E36] px-6 text-white hover:bg-[#913F2B] sm:w-auto">
                    <a href="#probeer-buildy">{publicDemo ? "Probeer met je bouwfoto" : "Start je verbouwverhaal"}</a>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="min-h-12 w-full border-white/45 bg-white/5 px-6 text-white backdrop-blur-sm hover:bg-white hover:text-[#26231F] sm:w-auto">
                    <a href={publicDemo ? "#voorbeeld" : "#zo-werkt-het"}>{publicDemo ? "Bekijk een voorbeeld" : "Bekijk hoe het werkt"}</a>
                  </Button>
                </div>
                <aside className="mt-8 flex max-w-xl items-start gap-3 border-l-2 border-[#E0A998] pl-4" aria-label="Privacybelofte">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#E0A998]" aria-hidden="true" />
                  <p className="text-sm leading-6 text-white/75">{publicDemo
                    ? "Je foto blijft op dit apparaat en wordt niet geüpload."
                    : "Je begint met Alleen ik. Delen gebeurt pas wanneer jij dat kiest."}</p>
                </aside>
              </div>
              <div className="min-w-0 lg:col-span-6">
                <HeroProductPreview publicDemo={publicDemo} />
              </div>
            </div>
          </section>

          <section id="zo-werkt-het" className="scroll-mt-28 border-b border-[#D8CFC1] bg-[#F7F2E9]" aria-labelledby="how-title">
            <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:px-8 md:py-24">
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-6">
                  <SectionLabel>Van vandaag naar later</SectionLabel>
                  <h2 id="how-title" className="max-w-2xl font-serif text-4xl leading-[0.95] text-[#26231F] md:text-6xl">
                    Eén eenvoudige lijn door je hele verbouwing.
                  </h2>
                </div>
                <p className="max-w-xl text-base leading-7 text-[#655F57] lg:col-span-4 lg:col-start-9 lg:pt-7">
                  Geen losse WhatsApp-foto’s of ingewikkeld projectdashboard. Ieder Bouwmoment krijgt een vaste plek in je Verhaal en Bouwboek.
                </p>
              </div>

              <ol className={`mt-12 border-y border-[#D8CFC1] md:grid ${publicDemo ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
                {(publicDemo ? PUBLIC_DEMO_STEPS : CORE_STEPS).map(({ icon: Icon, title, description }, index) => (
                  <li key={title} className="grid grid-cols-[3rem_1fr] gap-4 border-b border-[#D8CFC1] py-7 last:border-b-0 md:block md:border-b-0 md:border-r md:px-8 md:py-9 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
                    <div className="flex items-center justify-between md:mb-12">
                      <span className="text-xs font-semibold tabular-nums text-[#A94E36]">0{index + 1}</span>
                      <Icon className="hidden h-5 w-5 text-[#655F57] md:block" strokeWidth={1.5} aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold tracking-[-0.02em] text-[#26231F]">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[#655F57]">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <div className="border-b border-[#D8CFC1] bg-[#FFFDF8]">
            <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:px-8 md:py-24">
              <div className="mb-10 grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-6">
                  <SectionLabel>Probeer de hele lijn</SectionLabel>
                  <h2 className="max-w-2xl font-serif text-4xl leading-[0.95] text-[#26231F] md:text-6xl">Van foto naar Bouwboek, zonder upload.</h2>
                </div>
                <p className="max-w-xl text-base leading-7 text-[#655F57] lg:col-span-4 lg:col-start-9 lg:pt-7">
                  {publicDemo
                    ? "Kies één foto en zie hem direct als Bouwmoment, in je Verhaal en op een Bouwboekpagina. Je foto blijft op dit apparaat en wordt niet geüpload."
                    : "Kies één foto en zie hem direct als Bouwmoment, in je Verhaal en op een Bouwboekpagina. De foto blijft op dit apparaat totdat jij hem bewaart."}
                </p>
              </div>
              <LocalPhotoDemo
                feedbackEnabled={feedbackEnabled}
                publicDemo={publicDemo}
                saveHref={user ? `${PRODUCT_ROUTES.newProject}?intent=${LANDING_PHOTO_INTENT}` : LOCAL_PHOTO_AUTH_PATH}
              />
            </div>
          </div>

          <section id="voorbeeld" className="scroll-mt-28 border-b border-[#D8CFC1] bg-[#26231F] text-white" aria-labelledby="example-title">
            <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:px-8 md:py-24">
              <div className="mb-10 grid gap-5 lg:grid-cols-12">
                <div className="lg:col-span-6">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#E0A998]">
                    {publicDemo ? "Voorbeeldverbouwing" : "Samen beleven"}
                  </p>
                  <h2 id="example-title" className="max-w-2xl font-serif text-4xl leading-[0.95] md:text-6xl">
                    {publicDemo
                      ? "Van eerste sloopdag tot weer thuiskomen."
                      : "Delen zonder steeds hetzelfde verhaal te vertellen."}
                  </h2>
                </div>
                <p className="max-w-xl text-base leading-7 text-white/70 lg:col-span-4 lg:col-start-9 lg:pt-7">
                  {publicDemo
                    ? "Bekijk een volledig verzonnen verbouwing met meerdere Bouwmomenten in chronologische volgorde. Er worden geen klantgegevens geladen."
                    : "Een vriend ziet de foto’s, datum en het korte verhaal—zonder editknoppen. Ingelogd kan diegene reageren of een opmerking plaatsen."}
                </p>
              </div>
              <ExampleRenovation publicDemo={publicDemo} />
              {publicDemo ? <div className="mt-8 flex justify-center">
                <Button asChild size="lg" className="min-h-12 bg-[#A94E36] px-6 text-white hover:bg-[#8F3F2C]">
                  <Link to={PUBLIC_DEMO_EXAMPLE_PROJECT_PATH}>Bekijk de voorbeeldverbouwing <ArrowRight aria-hidden="true" /></Link>
                </Button>
              </div> : null}
            </div>
          </section>

          {!publicDemo ? <section className="border-b border-[#D8CFC1] bg-[#F7F2E9]" aria-labelledby="privacy-title">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:px-8 md:py-20 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <SectionLabel>Privacy zonder kleine lettertjes</SectionLabel>
                <h2 id="privacy-title" className="max-w-lg font-serif text-4xl leading-none text-[#26231F] md:text-5xl">
                  Jouw huis hoeft niet voor iedereen open te staan.
                </h2>
                <p className="mt-5 max-w-xl text-sm leading-6 text-[#655F57] md:text-base md:leading-7">
                  Drie begrijpelijke keuzes. Een nieuwe verbouwing begint altijd met Alleen ik.
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
          </section> : null}

          <section className="border-b border-[#D8CFC1] bg-[#FFFDF8]" aria-labelledby="book-title">
            <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 md:px-8 md:py-24 lg:grid-cols-12 lg:gap-10">
              <div className="lg:col-span-5">
                <SectionLabel>Voorbeeldweergave</SectionLabel>
                <h2 id="book-title" className="max-w-lg font-serif text-4xl leading-none text-[#26231F] md:text-5xl">
                  {publicDemo ? "Zo groeit je Bouwboek straks met je verbouwing mee." : "Je Bouwboek groeit met je verbouwing mee."}
                </h2>
                <p className="mt-5 max-w-xl text-base leading-7 text-[#655F57]">
                  {publicDemo
                    ? "Bekijk de omslag, openingsspread, chronologische Bouwmomenten en slotpagina van een statisch voorbeeld."
                    : "Ieder Bouwmoment krijgt automatisch een plek. Het digitale Bouwboek is gratis; jij kiest alleen wat je wilt bewaren."}
                </p>
                {publicDemo ? <p className="mt-3 text-sm font-medium text-[#655F57]">Fysiek bestellen volgt na de bèta.</p> : null}
                <Button asChild variant="outline" size="lg" className="mt-7 min-h-12 border-[#A94E36] bg-transparent px-6 text-[#26231F] hover:bg-[#A94E36] hover:text-white">
                  {publicDemo ? (
                    <Link to={PUBLIC_DEMO_EXAMPLE_BOOK_PATH}>Bekijk het voorbeeld-Bouwboek <ArrowRight aria-hidden="true" /></Link>
                  ) : (
                    <a href="#probeer-buildy">Start je verbouwverhaal <ArrowRight aria-hidden="true" /></a>
                  )}
                </Button>
              </div>
              <div className="lg:col-span-7">
                <ExampleBookSpread />
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
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#D8CFC1]">{publicDemo
                ? "Kies lokaal een foto en zie hem direct als Bouwmoment, Verhaal en Bouwboekspread."
                : "Probeer het op dit apparaat, begin privé en deel pas wanneer jij daar klaar voor bent."}</p>
            </div>
            <div className="lg:col-span-4 lg:flex lg:justify-end">
              <Button asChild size="lg" className="min-h-12 w-full bg-[#A94E36] px-6 text-white hover:bg-[#8F3F2C] sm:w-auto">
                <a href="#probeer-buildy">
                  {publicDemo ? "Probeer met je bouwfoto" : "Start je verbouwverhaal"} <ArrowRight aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
};

export default Index;
