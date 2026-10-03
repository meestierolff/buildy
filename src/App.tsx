import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Route, Routes, useLocation } from "@/lib/router";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useProjectDashboard } from "@/hooks/useProjectApi";
import ErrorBoundary from "@/components/ErrorBoundary";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { AppShell, LegacyRedirect, MobileNav } from "@/components/app";
import { getMobileNavigationItems, PRODUCT_ROUTES } from "@/lib/productNavigation";

const Index = lazy(() => import("./pages/Index"));
const OnboardingDialog = lazy(() => import("@/components/app/OnboardingDialog"));
const FeedbackLauncher = lazy(() => import("@/components/moderation/FeedbackLauncher"));
const Terms = lazy(() => import("./pages/legal/Terms"));
const Privacy = lazy(() => import("./pages/legal/Privacy"));
const ContentPolicy = lazy(() => import("./pages/legal/ContentPolicy"));
const HouseRules = lazy(() => import("./pages/legal/HouseRules"));

// Heavier / less-frequently visited routes are code-split so the initial bundle stays small.
const Auth = lazy(() => import("./pages/Auth"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const NewTrip = lazy(() => import("./pages/NewTrip"));
const TripDetail = lazy(() => import("./pages/TripDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const Photobook = lazy(() => import("./pages/Photobook"));
const Books = lazy(() => import("./pages/Books"));
const Favorites = lazy(() => import("./pages/Favorites"));
const Friends = lazy(() => import("./pages/Friends"));
const Support = lazy(() => import("./pages/Support"));
const Feedback = lazy(() => import("./pages/Feedback"));
const Report = lazy(() => import("./pages/Report"));
const ModerationAdmin = lazy(() => import("./pages/ModerationAdmin"));
const FeedbackAdmin = lazy(() => import("./pages/FeedbackAdmin"));
const NewUpdate = lazy(() => import("./pages/NewUpdate"));
const Notifications = lazy(() => import("./pages/Notifications"));
const ShareLinkRedeem = lazy(() => import("./pages/ShareLinkRedeem"));
const NotFound = lazy(() => import("./pages/NotFound"));

const RouteFallback = () => (
  <main className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    <span className="sr-only">Laden…</span>
  </main>
);

const routeParam = (
  params: Readonly<Record<string, string | undefined>>,
  key: string,
): string | null => params[key]?.trim() || null;

const ApplicationFrame = () => {
  const { user } = useAuth();
  const dashboardQuery = useProjectDashboard(Boolean(user));
  const { pathname } = useLocation();
  const hidesMobileNavigation = pathname === "/auth";
  const ownProjects = dashboardQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const routeProjectId = /^\/project\/([^/]+)/.exec(pathname)?.[1];
  const activeProjectId = ownProjects.find((project) => project.id === routeProjectId)?.id
    ?? ownProjects[0]?.id;
  const storyHref = PRODUCT_ROUTES.projects;
  const navigationItems = getMobileNavigationItems({
    storyHref,
    updateHref: routeProjectId && activeProjectId === routeProjectId
      ? PRODUCT_ROUTES.projectUpdateComposer(activeProjectId)
      : ownProjects.length === 1
        ? PRODUCT_ROUTES.projectUpdateComposer(ownProjects[0].id)
        : ownProjects.length > 1 ? PRODUCT_ROUTES.createUpdate : PRODUCT_ROUTES.newProject,
    photobookHref: pathname.endsWith("/bouwboek") && activeProjectId === routeProjectId
      ? PRODUCT_ROUTES.projectPhotobook(activeProjectId)
      : PRODUCT_ROUTES.books,
    profileHref: PRODUCT_ROUTES.ownProfile,
  });
  const showFeedbackLauncher = Boolean(user) && !["/feedback", "/support", "/melden"].includes(pathname);

  return (
    <>
      <AppShell
        header={<Header updateHref={navigationItems.find((item) => item.id === "update")?.href} />}
        footer={user ? undefined : <Footer />}
        mobileNavigation={!user || hidesMobileNavigation ? undefined : (
          <MobileNav items={navigationItems} label="Mobiele navigatie" />
        )}
      >
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/projecten" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/account" element={<AccountSettings />} />
              <Route path="/project/nieuw" element={<NewTrip />} />
              <Route path="/update/nieuw" element={<NewUpdate />} />
              <Route path="/project/:id/bouwboek" element={<Photobook />} />
              <Route path="/bouwboeken" element={<Books />} />
              <Route path="/project/:id" element={<TripDetail />} />
              <Route path="/volgend" element={<Favorites />} />
              <Route path="/connecties" element={<Friends />} />
              <Route path="/profiel" element={<Profile />} />
              <Route path="/profiel/:profileKey" element={<Profile />} />
              <Route path="/notificaties" element={<Notifications />} />
              <Route path="/delen" element={<ShareLinkRedeem />} />
              <Route path="/trips/new" element={<LegacyRedirect resolve={() => PRODUCT_ROUTES.newProject} />} />
              <Route path="/trip/:id/photobook" element={<LegacyRedirect resolve={(params) => {
                const id = routeParam(params, "id");
                return id ? PRODUCT_ROUTES.projectPhotobook(id) : null;
              }} />} />
              <Route path="/projecten/:id/bouwboek" element={<LegacyRedirect resolve={(params) => {
                const id = routeParam(params, "id");
                return id ? PRODUCT_ROUTES.projectPhotobook(id) : null;
              }} />} />
              <Route path="/trip/:id" element={<LegacyRedirect resolve={(params) => {
                const id = routeParam(params, "id");
                return id ? PRODUCT_ROUTES.project(id) : null;
              }} />} />
              <Route path="/favorieten" element={<LegacyRedirect resolve={() => PRODUCT_ROUTES.following} />} />
              <Route path="/vrienden" element={<LegacyRedirect resolve={() => PRODUCT_ROUTES.connections} />} />
              <Route path="/profile/:profileKey" element={<LegacyRedirect resolve={(params) => {
                const profileKey = routeParam(params, "profileKey");
                return profileKey ? PRODUCT_ROUTES.profile(profileKey) : null;
              }} />} />
              <Route path="/voorwaarden" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/contentbeleid" element={<ContentPolicy />} />
              <Route path="/huisregels" element={<HouseRules />} />
              <Route path="/support" element={<Support />} />
              <Route path="/feedback" element={<Feedback />} />
              <Route path="/melden" element={<Report />} />
              <Route path="/beheer/moderatie" element={<ModerationAdmin />} />
              <Route path="/beheer/moderatie/:reportId" element={<ModerationAdmin />} />
              <Route path="/beheer/feedback" element={<FeedbackAdmin />} />
              <Route path="/beheer/feedback/:submissionId" element={<FeedbackAdmin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </AppShell>
      {user ? (
        <Suspense fallback={null}>
          <OnboardingDialog
            enabled={dashboardQuery.isSuccess}
            activeProjectId={activeProjectId}
          />
        </Suspense>
      ) : null}
      {showFeedbackLauncher ? (
        <Suspense fallback={null}>
          <FeedbackLauncher />
        </Suspense>
      ) : null}
    </>
  );
};

const App = () => (
  <TooltipProvider>
    <Sonner />
    <BrowserRouter>
      <AuthProvider>
        <ApplicationFrame />
      </AuthProvider>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
