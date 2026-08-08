import { LifeBuoy, ShieldAlert } from "lucide-react";
import SupportForm from "@/components/moderation/SupportForm";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Link } from "@/lib/router";

const Support = () => {
  usePageMeta({
    title: "Support en verzoeken — Buildy",
    description: "Stel een supportvraag, doe een privacyverzoek als derde of maak bezwaar tegen een contentbesluit.",
    path: "/support",
    noIndex: true,
  });
  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 md:grid-cols-[0.8fr_1.2fr] md:px-8 md:py-16">
      <section>
        <p className="eyebrow flex items-center gap-2"><LifeBuoy className="h-4 w-4" aria-hidden="true" /> Support</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">Waar kunnen we naar kijken?</h1>
        <p className="mt-5 max-w-xl leading-7 text-muted-foreground">
          Dit formulier is er voor account- en productvragen, verzoeken van mensen die op
          een foto of in tekst voorkomen, en bezwaar tegen een contentbesluit. Je hebt geen
          account nodig.
        </p>
        <div className="mt-8 border-l-2 border-amber-600 bg-amber-500/5 p-4 text-sm leading-6">
          <p className="flex gap-2 font-semibold"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Geen noodkanaal</p>
          <p className="mt-1 text-muted-foreground">Bij direct gevaar bel je 112. Deel hier geen wachtwoorden, toegangscodes of volledige adresgegevens.</p>
        </div>
        <nav className="mt-8 flex flex-col items-start gap-3 text-sm" aria-label="Beleid en informatie">
          <Link to="/contentbeleid" className="font-medium text-accent underline underline-offset-4">Lees het contentbeleid</Link>
          <Link to="/huisregels" className="font-medium text-accent underline underline-offset-4">Lees de huisregels</Link>
          <Link to="/privacy" className="font-medium text-accent underline underline-offset-4">Lees de privacy-informatie</Link>
        </nav>
      </section>
      <section className="border-y border-border bg-card/50 p-5 sm:p-8" aria-label="Supportformulier">
        <SupportForm />
      </section>
    </main>
  );
};

export default Support;

