import { Loader2, MessageSquareText } from "lucide-react";
import FeedbackForm from "@/components/moderation/FeedbackForm";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Link, Navigate } from "@/lib/router";

const Feedback = () => {
  usePageMeta({
    title: "Feedback — Buildy",
    description: "Help Buildy verbeteren met privacybewuste productfeedback.",
    path: "/feedback",
    noIndex: true,
  });
  const { loading, user } = useAuth();
  if (loading) {
    return <main className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sessie controleren…</main>;
  }
  if (!user) return <Navigate to="/auth" replace />;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:px-8 md:py-16">
      <header className="border-b border-border pb-7">
        <p className="eyebrow flex items-center gap-2"><MessageSquareText className="h-4 w-4" aria-hidden="true" /> Productfeedback</p>
        <h1 className="mt-3 font-serif text-4xl">Help Buildy beter bouwen</h1>
        <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">Vertel wat je probeerde en waar je vastliep. Feedback wordt versleuteld opgeslagen; zet geen persoonsgegevens in je bericht.</p>
      </header>
      <section className="py-8"><FeedbackForm /></section>
      <p className="border-t border-border pt-5 text-sm text-muted-foreground">Hulp nodig of wil je een privacyverzoek doen? Ga naar <Link to="/support" className="font-medium text-accent underline underline-offset-2">Support</Link>.</p>
    </main>
  );
};

export default Feedback;
