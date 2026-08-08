import { Flag } from "lucide-react";
import SupportForm from "@/components/moderation/SupportForm";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Link } from "@/lib/router";

const Report = () => {
  usePageMeta({
    title: "Iets melden — Buildy",
    description: "Meld Buildy-inhoud of doe zonder account een verzoek over jezelf of je gegevens.",
    path: "/melden",
    noIndex: true,
  });
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:px-8 md:py-16">
      <header className="max-w-2xl">
        <p className="eyebrow flex items-center gap-2"><Flag className="h-4 w-4" aria-hidden="true" /> Melden</p>
        <h1 className="mt-3 font-serif text-4xl">Meld het op de plek waar je het ziet</h1>
        <p className="mt-4 leading-7 text-muted-foreground">Bij een profiel, project, update, foto of reactie staat een knop <em>Melden</em>. Daarmee kan de server eerst veilig controleren dat de inhoud voor jou zichtbaar is.</p>
      </header>
      <section className="mt-9 border-l-2 border-accent bg-accent/5 p-5">
        <h2 className="font-semibold">Geen account of gaat de inhoud over jou?</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Gebruik onderstaand derdenverzoek. Beschrijf waar de inhoud staat zonder wachtwoorden, toegangscodes of meer persoonsgegevens dan nodig.</p>
      </section>
      <section className="mt-7 border-y border-border p-5 sm:p-8"><SupportForm initialKind="third_party_request" /></section>
      <p className="mt-6 text-sm text-muted-foreground">Lees ook het <Link to="/contentbeleid" className="font-medium text-accent underline underline-offset-2">contentbeleid</Link>.</p>
    </main>
  );
};

export default Report;

