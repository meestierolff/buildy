import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "@/lib/router";
import { AuthProvider } from "@/hooks/useAuth";
import { useAuth } from "@/hooks/useAuth";
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
const Withdrawal = lazy(() => import("./pages/legal/Withdrawal"));
const ContentPolicy = lazy(() => import("./pages/legal/ContentPolicy"));
const HouseRules = lazy(() => import("./pages/legal/HouseRules"));

// Heavier / less-frequently visited routes are code-split so the initial bundle stays small.
const Auth = lazy(() => import("./pages/Auth"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const NewTrip = lazy(() => import("./pages/NewTrip"));
const TripDetail = lazy(() => import("./pages/TripDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const Photobook = lazy(() => import("./pages/Photobook"));
const Budget = lazy(() => import("./pages/Budget"));
const Favorites = lazy(() => import("./pages/Favorites"));
const Friends = lazy(() => import("./pages/Friends"));
const OrderConfirmation = lazy(() => import("./pages/OrderConfirmation"));
const Orders = lazy(() => import("./pages/Orders"));
const Support = lazy(() => import("./pages/Support"));
const Feedback = lazy(() => import("./pages/Feedback"));
const Report = lazy(() => import("./pages/Report"));
const ModerationAdmin = lazy(() => import("./pages/ModerationAdmin"));
const OrderAdmin = lazy(() => import("./pages/OrderAdmin"));
const FeedbackAdmin = lazy(() => import("./pages/FeedbackAdmin"));
const NewUpdate = lazy(() => import("./pages/NewUpdate"));
const Notifications = lazy(() => import("./pages/Notifications"));
const ShareLinkRedeem = lazy(() => import("./pages/ShareLinkRedeem"));
const NotFound = lazy(() => import("./pages/NotFound"));

const RouteFallback = () => (
  <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    <span className="sr-only">Laden…</span>
  </div>
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
  const activeProjectId = dashboardQuery.data?.pages
    .flatMap((page) => page.items)
    .at(0)?.id;
  const storyHref = activeProjectId
    ? PRODUCT_ROUTES.project(activeProjectId)
    : PRODUCT_ROUTES.newProject;
  const navigationItems = getMobileNavigationItems({
    storyHref,
    updateHref: activeProjectId
      ? PRODUCT_ROUTES.projectUpdateComposer(activeProjectId)
      : PRODUCT_ROUTES.newProject,
    photobookHref: activeProjectId
      ? PRODUCT_ROUTES.projectPhotobook(activeProjectId)
      : PRODUCT_ROUTES.newProject,
    profileHref: PRODUCT_ROUTES.ownProfile,
  });
  const showFeedbackLauncher = Boolean(user) && !["/feedback", "/support", "/melden"].includes(pathname);

  return (
    <>
      <AppShell
        header={<Header activeProjectId={activeProjectId} />}
        footer={<Footer />}
        mobileNavigation={!user || hidesMobileNavigation ? undefined : (
          <MobileNav items={navigationItems} label="Mobiele navigatie" />
        )}
      >
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/ontdekken" element={<Index />} />
              <Route path="/projecten" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/account" element={<Navigate to={PRODUCT_ROUTES.ownProfile} replace />} />
              <Route path="/project/nieuw" element={<NewTrip />} />
              <Route path="/update/nieuw" element={<NewUpdate />} />
              <Route path="/project/:id/bouwboek" element={<Photobook />} />
              <Route path="/project/:id/budget" element={<Budget />} />
              <Route path="/project/:id" element={<TripDetail />} />
              <Route path="/volgend" element={<Favorites />} />
              <Route path="/connecties" element={<Friends />} />
              <Route path="/profiel" element={<AccountSettings />} />
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
              <Route path="/trip/:id/budget" element={<LegacyRedirect resolve={(params) => {
                const id = routeParam(params, "id");
                return id ? PRODUCT_ROUTES.projectBudget(id) : null;
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
              <Route path="/bestelling/:orderId" element={<OrderConfirmation />} />
              <Route path="/bestellingen" element={<Orders />} />
              <Route path="/bestellingen/:orderId" element={<OrderConfirmation />} />
              <Route path="/voorwaarden" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/herroeping" element={<Withdrawal />} />
              <Route path="/contentbeleid" element={<ContentPolicy />} />
              <Route path="/huisregels" element={<HouseRules />} />
              <Route path="/support" element={<Support />} />
              <Route path="/feedback" element={<Feedback />} />
              <Route path="/melden" element={<Report />} />
              <Route path="/beheer/moderatie" element={<ModerationAdmin />} />
              <Route path="/beheer/moderatie/:reportId" element={<ModerationAdmin />} />
              <Route path="/beheer/bestellingen" element={<OrderAdmin />} />
              <Route path="/beheer/bestellingen/:orderId" element={<OrderAdmin />} />
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
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <AuthProvider>
        <ApplicationFrame />
      </AuthProvider>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
