import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Index from "./pages/Index";

const Terms = lazy(() => import("./pages/legal/Terms"));
const Privacy = lazy(() => import("./pages/legal/Privacy"));
const Withdrawal = lazy(() => import("./pages/legal/Withdrawal"));

// Heavier / less-frequently visited routes are code-split so the initial bundle
// stays small (e.g. jspdf + html2canvas only load on Photobook, leaflet on TripDetail).
const Auth = lazy(() => import("./pages/Auth"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const NewTrip = lazy(() => import("./pages/NewTrip"));
const TripDetail = lazy(() => import("./pages/TripDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const Photobook = lazy(() => import("./pages/Photobook"));
const Budget = lazy(() => import("./pages/Budget"));
const Favorites = lazy(() => import("./pages/Favorites"));
const Friends = lazy(() => import("./pages/Friends"));
const OrderConfirmation = lazy(() => import("./pages/OrderConfirmation"));
const NotFound = lazy(() => import("./pages/NotFound"));

const RouteFallback = () => (
  <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    <span className="sr-only">Laden…</span>
  </div>
);

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 pb-[56px] md:pb-0">
            <ErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/wachtwoord-vergeten" element={<ForgotPassword />} />
                  <Route path="/wachtwoord-resetten" element={<ResetPassword />} />
                  <Route path="/account" element={<AccountSettings />} />
                  <Route path="/trips/new" element={<NewTrip />} />
                  <Route path="/trip/:id" element={<TripDetail />} />
                  <Route path="/trip/:id/photobook" element={<Photobook />} />
                  <Route path="/trip/:id/budget" element={<Budget />} />
                  <Route path="/favorieten" element={<Favorites />} />
                  <Route path="/vrienden" element={<Friends />} />
                  <Route path="/profile/:userId" element={<Profile />} />
                  <Route path="/bestelling/:orderId" element={<OrderConfirmation />} />
                  <Route path="/voorwaarden" element={<Terms />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/herroeping" element={<Withdrawal />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
          <Footer />
        </div>
      </AuthProvider>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
