import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Header from "@/components/Header";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NewTrip from "./pages/NewTrip";
import TripDetail from "./pages/TripDetail";
import Profile from "./pages/Profile";
import Photobook from "./pages/Photobook";
import Budget from "./pages/Budget";
import Favorites from "./pages/Favorites";
import Friends from "./pages/Friends";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 pb-[56px] md:pb-0">
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/trips/new" element={<NewTrip />} />
                <Route path="/trip/:id" element={<TripDetail />} />
                <Route path="/trip/:id/photobook" element={<Photobook />} />
                <Route path="/trip/:id/budget" element={<Budget />} />
                <Route path="/favorieten" element={<Favorites />} />
                <Route path="/vrienden" element={<Friends />} />
                <Route path="/profile/:userId" element={<Profile />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
          </div>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
