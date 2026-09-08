import { lazy, Suspense, useEffect } from "react";
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
import { useProductProfile } from "@/hooks/useProductProfile";
import {
  PUBLIC_DEMO_EXAMPLE_BOOK_PATH,
  PUBLIC_DEMO_EXAMPLE_PROJECT_PATH,
} from "@/lib/publicDemo";

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
const PublicDemoDeferred = lazy(() => import("./pages/PublicDemoDeferred"));
const PublicExampleRenovation = lazy(() => import("./pages/PublicDemoExample").then((module) => ({
  default: module.PublicExampleRenovation,
})));
const PublicExampleBook = lazy(() => import("./pages/PublicDemoExample").then((module) => ({
  default: module.PublicExampleBook,
})));

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

const ApplicationFrame = ({
  publicDemo,
  publicFeedbackEnabled,
}: {
  publicDemo: boolean;
  publicFeedbackEnabled: boolean;
}) => {
  const { user } = useAuth();
  const dashboardQuery = useProjectDashboard(!publicDemo && Boolean(user));
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!publicDemo || hash) return undefined;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ left: 0, top: 0 }));
    return () => window.cancelAnimationFrame(frame);
  }, [hash, pathname, publicDemo]);
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
        header={<Header activeProjectId={activeProjectId} publicDemo={publicDemo} />}
        footer={<Footer feedbackEnabled={publicFeedbackEnabled} publicDemo={publicDemo} />}
        mobileNavigation={!user || hidesMobileNavigation ? undefined : (
          <MobileNav items={navigationItems} label="Mobiele navigatie" />
        )}
      >
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index feedbackEnabled={publicFeedbackEnabled} publicDemo={publicDemo} />} />
              <Route path={PUBLIC_DEMO_EXAMPLE_PROJECT_PATH} element={publicDemo ? <PublicExampleRenovation /> : <NotFound />} />
              <Route path={PUBLIC_DEMO_EXAMPLE_BOOK_PATH} element={publicDemo ? <PublicExampleBook /> : <NotFound />} />
              <Route path="/ontdekken" element={publicDemo ? <Navigate to={PUBLIC_DEMO_EXAMPLE_PROJECT_PATH} replace /> : <Index />} />
              <Route path="/projecten" element={publicDemo ? <PublicDemoDeferred /> : <Index />} />
              <Route path="/auth" element={publicDemo ? <PublicDemoDeferred /> : <Auth />} />
              <Route path="/account" element={publicDemo ? <PublicDemoDeferred /> : <Navigate to={PRODUCT_ROUTES.ownProfile} replace />} />
              <Route path="/project/nieuw" element={publicDemo ? <PublicDemoDeferred /> : <NewTrip />} />
              <Route path="/update/nieuw" element={publicDemo ? <PublicDemoDeferred /> : <NewUpdate />} />
              <Route path="/project/:id/bouwboek" element={publicDemo ? <PublicDemoDeferred /> : <Photobook />} />
              <Route path="/project/:id/budget" element={publicDemo ? <PublicDemoDeferred /> : <Budget />} />
              <Route path="/project/:id" element={publicDemo ? <PublicDemoDeferred /> : <TripDetail />} />
              <Route path="/volgend" element={publicDemo ? <PublicDemoDeferred /> : <Favorites />} />
              <Route path="/connecties" element={publicDemo ? <PublicDemoDeferred /> : <Friends />} />
              <Route path="/profiel" element={publicDemo ? <PublicDemoDeferred /> : <AccountSettings />} />
              <Route path="/profiel/:profileKey" element={publicDemo ? <PublicDemoDeferred /> : <Profile />} />
              <Route path="/notificaties" element={publicDemo ? <PublicDemoDeferred /> : <Notifications />} />
              <Route path="/meldingen" element={publicDemo ? <PublicDemoDeferred /> : <NotFound />} />
              <Route path="/delen" element={publicDemo ? <PublicDemoDeferred /> : <ShareLinkRedeem />} />
              <Route path="/trips/new" element={publicDemo ? <PublicDemoDeferred /> : <LegacyRedirect resolve={() => PRODUCT_ROUTES.newProject} />} />
              <Route path="/trip/:id/photobook" element={publicDemo ? <PublicDemoDeferred /> : <LegacyRedirect resolve={(params) => {
                const id = routeParam(params, "id");
                return id ? PRODUCT_ROUTES.projectPhotobook(id) : null;
              }} />} />
              <Route path="/projecten/:id/bouwboek" element={publicDemo ? <PublicDemoDeferred /> : <LegacyRedirect resolve={(params) => {
                const id = routeParam(params, "id");
                return id ? PRODUCT_ROUTES.projectPhotobook(id) : null;
              }} />} />
              <Route path="/trip/:id/budget" element={publicDemo ? <PublicDemoDeferred /> : <LegacyRedirect resolve={(params) => {
                const id = routeParam(params, "id");
                return id ? PRODUCT_ROUTES.projectBudget(id) : null;
              }} />} />
              <Route path="/trip/:id" element={publicDemo ? <PublicDemoDeferred /> : <LegacyRedirect resolve={(params) => {
                const id = routeParam(params, "id");
                return id ? PRODUCT_ROUTES.project(id) : null;
              }} />} />
              <Route path="/favorieten" element={publicDemo ? <PublicDemoDeferred /> : <LegacyRedirect resolve={() => PRODUCT_ROUTES.following} />} />
              <Route path="/vrienden" element={publicDemo ? <PublicDemoDeferred /> : <LegacyRedirect resolve={() => PRODUCT_ROUTES.connections} />} />
              <Route path="/profile/:profileKey" element={publicDemo ? <PublicDemoDeferred /> : <LegacyRedirect resolve={(params) => {
                const profileKey = routeParam(params, "profileKey");
                return profileKey ? PRODUCT_ROUTES.profile(profileKey) : null;
              }} />} />
              <Route path="/bestelling/:orderId" element={publicDemo ? <PublicDemoDeferred /> : <OrderConfirmation />} />
              <Route path="/bestellingen" element={publicDemo ? <PublicDemoDeferred /> : <Orders />} />
              <Route path="/bestellingen/:orderId" element={publicDemo ? <PublicDemoDeferred /> : <OrderConfirmation />} />
              <Route path="/voorwaarden" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/herroeping" element={<Withdrawal />} />
              <Route path="/contentbeleid" element={<ContentPolicy />} />
              <Route path="/huisregels" element={<HouseRules />} />
              <Route path="/support" element={publicDemo && !publicFeedbackEnabled ? <Navigate to="/" replace /> : <Support publicDemo={publicDemo} />} />
              <Route path="/feedback" element={publicDemo ? <Navigate to={publicFeedbackEnabled ? "/support" : "/"} replace /> : <Feedback />} />
              <Route path="/melden" element={publicDemo ? <PublicDemoDeferred /> : <Report />} />
              <Route path="/beheer/moderatie" element={publicDemo ? <PublicDemoDeferred /> : <ModerationAdmin />} />
              <Route path="/beheer/moderatie/:reportId" element={publicDemo ? <PublicDemoDeferred /> : <ModerationAdmin />} />
              <Route path="/beheer/bestellingen" element={publicDemo ? <PublicDemoDeferred /> : <OrderAdmin />} />
              <Route path="/beheer/bestellingen/:orderId" element={publicDemo ? <PublicDemoDeferred /> : <OrderAdmin />} />
              <Route path="/beheer/feedback" element={publicDemo ? <PublicDemoDeferred /> : <FeedbackAdmin />} />
              <Route path="/beheer/feedback/:submissionId" element={publicDemo ? <PublicDemoDeferred /> : <FeedbackAdmin />} />
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

const ProductProfileApplication = () => {
  const profileQuery = useProductProfile();

  if (profileQuery.isPending) return <RouteFallback />;
  if (profileQuery.isError || !profileQuery.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F7F2E9] px-6 text-center">
        <div className="max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Buildy</p>
          <h1 className="mt-3 font-serif text-4xl text-[#26231F]">De demo kon niet veilig worden geladen.</h1>
          <p className="mt-4 text-sm leading-6 text-[#655F57]">Vernieuw de productstatus en probeer het opnieuw.</p>
          <button
            type="button"
            onClick={() => void profileQuery.refetch()}
            className="mt-6 min-h-11 rounded-md bg-[#A94E36] px-5 text-sm font-semibold text-white hover:bg-[#8F3F2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Opnieuw proberen
          </button>
        </div>
      </main>
    );
  }

  const publicDemo = profileQuery.data.profile === "public_demo";
  const publicFeedbackEnabled = publicDemo && profileQuery.data.capabilities.feedback;
  return (
    <AuthProvider enabled={!publicDemo}>
      <ApplicationFrame
        publicDemo={publicDemo}
        publicFeedbackEnabled={publicFeedbackEnabled}
      />
    </AuthProvider>
  );
};

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <ProductProfileApplication />
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
