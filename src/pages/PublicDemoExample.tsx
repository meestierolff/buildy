import { ArrowLeft, ArrowRight, BookOpen, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  PUBLIC_DEMO_EXAMPLE_BOOK_PATH,
  PUBLIC_DEMO_EXAMPLE_PROJECT_PATH,
} from "@/lib/publicDemo";
import { Link } from "@/lib/router";

export {
  PUBLIC_DEMO_EXAMPLE_BOOK_PATH,
  PUBLIC_DEMO_EXAMPLE_PROJECT_PATH,
};

const EXAMPLE_MOMENTS = [
  {
    date: "6 april",
    title: "De oude keuken is eruit.",
    caption: "De eerste lege ruimte maakt zichtbaar hoeveel er gaat veranderen.",
    image: "/images/buildy-renovation-progress.webp",
    alt: "Synthetisch voorbeeld van de benedenverdieping tijdens de eerste werkzaamheden",
  },
  {
    date: "12 mei",
    title: "De achtergevel is open.",
    caption: "Na weken slopen komt er eindelijk daglicht binnen.",
    image: "/images/buildy-renovation-progress.webp",
    alt: "Synthetisch voorbeeld van een open achtergevel tijdens de verbouwing",
  },
  {
    date: "28 juni",
    title: "We wonen weer beneden.",
    caption: "De dozen zijn weg en de kamer voelt opnieuw als thuis.",
    image: "/images/buildy-renovation-complete.webp",
    alt: "Synthetisch voorbeeld van de afgeronde benedenverdieping",
  },
] as const;

export const PublicExampleRenovation = () => {
  usePageMeta({
    title: "Voorbeeldverbouwing — Buildy",
    description: "Bekijk een volledig verzonnen Buildy-verbouwing van Bouwmoment tot Bouwboek.",
    path: PUBLIC_DEMO_EXAMPLE_PROJECT_PATH,
  });

  return (
    <div className="bg-[#FFFDF8] text-[#26231F]">
      <section className="border-b border-[#D8CFC1] bg-[#26231F] text-white">
        <div className="mx-auto grid max-w-7xl items-end gap-8 px-4 py-14 sm:px-6 md:px-8 md:py-20 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#E0A998]">Voorbeeldverbouwing</p>
            <h1 className="mt-4 max-w-4xl font-serif text-5xl leading-[0.92] sm:text-6xl md:text-7xl">
              De benedenverdieping
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/75">
              Dit voorbeeld is volledig verzonnen en gebruikt alleen repository-eigen beeld. Het toont geen echte klant, woning of activiteit.
            </p>
          </div>
          <div className="lg:col-span-4 lg:flex lg:justify-end">
            <Button asChild variant="outline" className="min-h-11 border-white/40 bg-transparent text-white hover:bg-white hover:text-[#26231F]">
              <a href="/#voorbeeld"><ArrowLeft aria-hidden="true" /> Terug naar de demo</a>
            </Button>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 md:px-8 md:py-20">
        <div className="mb-10 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Chronologisch Verhaal</p>
            <h2 className="mt-3 font-serif text-4xl leading-none md:text-5xl">Drie Bouwmomenten, één rustige lijn.</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[#655F57] lg:col-span-4 lg:col-start-9 lg:pt-7">
            Datum, foto en een korte herinnering blijven bij elkaar. Zo groeit het Verhaal vanzelf mee met het werk.
          </p>
        </div>

        <ol className="grid gap-7 md:grid-cols-3" aria-label="Voorbeeld Bouwmomenten">
          {EXAMPLE_MOMENTS.map((moment, index) => (
            <li key={moment.date} className="border-t border-[#D8CFC1] pt-4">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em]">
                <span className="text-[#A94E36]">Bouwmoment {index + 1}</span>
                <time className="text-[#655F57]">{moment.date}</time>
              </div>
              <img src={moment.image} alt={moment.alt} className="mt-4 aspect-[4/3] w-full object-cover" />
              <h3 className="mt-5 font-serif text-3xl leading-none">{moment.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#655F57]">{moment.caption}</p>
            </li>
          ))}
        </ol>

        <aside className="mt-10 flex max-w-xl items-start gap-3 border-l-2 border-[#A94E36] bg-[#F7F2E9] p-4 text-sm leading-6 text-[#655F57]">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#A94E36]" aria-hidden="true" />
          <p><strong className="text-[#26231F]">Voorbeeldreactie · demonstratie:</strong> “Wat een verschil met die eerste dag.” Dit is geen bericht van een echte gebruiker.</p>
        </aside>

        <div className="mt-14 border-y border-[#D8CFC1] py-8 sm:flex sm:items-center sm:justify-between sm:gap-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Volgende stap</p>
            <p className="mt-2 font-serif text-3xl">Bekijk dezelfde momenten in het Bouwboek.</p>
          </div>
          <Button asChild size="lg" className="mt-5 min-h-12 bg-[#A94E36] text-white hover:bg-[#8F3F2C] sm:mt-0">
            <Link to={PUBLIC_DEMO_EXAMPLE_BOOK_PATH}>Bekijk het voorbeeld-Bouwboek <ArrowRight aria-hidden="true" /></Link>
          </Button>
        </div>
      </main>
    </div>
  );
};

const BookPage = ({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) => (
  <article className={`flex min-h-72 flex-col border border-[#D8CFC1] bg-[#FFFDF8] p-5 shadow-[0_18px_45px_rgba(38,35,31,0.08)] sm:p-7 ${className}`}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A94E36]">{label}</p>
    {children}
  </article>
);

export const PublicExampleBook = () => {
  usePageMeta({
    title: "Voorbeeld-Bouwboek — Buildy",
    description: "Bekijk een statische voorbeeldweergave van een digitaal Buildy Bouwboek.",
    path: PUBLIC_DEMO_EXAMPLE_BOOK_PATH,
  });

  return (
    <main className="bg-[#F7F2E9] px-4 py-12 text-[#26231F] sm:px-6 md:px-8 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Voorbeeldweergave</p>
            <h1 className="mt-4 max-w-3xl font-serif text-5xl leading-[0.92] sm:text-6xl md:text-7xl">Ons bouwverhaal</h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[#655F57]">Zo groeit je Bouwboek straks met je verbouwing mee.</p>
            <p className="mt-3 text-sm font-medium text-[#655F57]">Fysiek bestellen volgt na de bèta.</p>
          </div>
          <div className="flex items-end lg:col-span-4 lg:justify-end">
            <Button asChild variant="outline" className="min-h-11 border-[#A94E36] bg-transparent hover:bg-[#A94E36] hover:text-white">
              <Link to={PUBLIC_DEMO_EXAMPLE_PROJECT_PATH}><ArrowLeft aria-hidden="true" /> Terug naar het Verhaal</Link>
            </Button>
          </div>
        </div>

        <section className="mt-12 grid gap-5 md:grid-cols-2" aria-label="Pagina’s in het voorbeeld-Bouwboek">
          <BookPage label="Omslag" className="relative min-h-[28rem] overflow-hidden bg-[#26231F] text-white">
            <img src="/images/buildy-renovation-complete.webp" alt="Omslagfoto van de synthetische voorbeeldverbouwing" className="absolute inset-0 h-full w-full object-cover opacity-45" />
            <div className="relative mt-auto">
              <BookOpen className="mb-5 h-6 w-6 text-[#E0A998]" aria-hidden="true" />
              <h2 className="max-w-sm font-serif text-5xl leading-[0.92]">Ons bouwverhaal</h2>
              <p className="mt-3 text-sm text-white/75">De benedenverdieping · voorbeeld</p>
            </div>
          </BookPage>

          <BookPage label="Openingsspread">
            <div className="my-auto border-y border-[#D8CFC1] py-10 text-center">
              <p className="font-serif text-4xl leading-none">Een huis verandert kamer voor kamer.</p>
              <p className="mx-auto mt-5 max-w-sm text-sm leading-6 text-[#655F57]">Dit volledig verzonnen Bouwboek bewaart de momenten tussen eerste sloopdag en thuiskomen.</p>
            </div>
          </BookPage>

          <BookPage label="Bouwmoment · 6 april">
            <img src="/images/buildy-renovation-progress.webp" alt="Eerste chronologische fotospread van de synthetische verbouwing" className="mt-5 aspect-[16/10] w-full object-cover" />
            <h2 className="mt-5 font-serif text-3xl leading-none">De oude keuken is eruit.</h2>
            <p className="mt-3 text-sm leading-6 text-[#655F57]">De lege ruimte markeert het begin van het Verhaal.</p>
          </BookPage>

          <BookPage label="Bouwmoment · 28 juni">
            <img src="/images/buildy-renovation-complete.webp" alt="Laatste chronologische fotospread van de synthetische verbouwing" className="mt-5 aspect-[16/10] w-full object-cover" />
            <h2 className="mt-5 font-serif text-3xl leading-none">We wonen weer beneden.</h2>
            <p className="mt-3 text-sm leading-6 text-[#655F57]">Dezelfde plek, bewaard aan het einde van de verbouwing.</p>
          </BookPage>

          <BookPage label="Slotpagina" className="md:col-span-2">
            <div className="my-auto mx-auto max-w-xl text-center">
              <p className="font-serif text-5xl leading-none">Thuis.</p>
              <p className="mt-5 text-sm leading-6 text-[#655F57]">Van losse foto’s naar één verhaal om te bewaren.</p>
            </div>
          </BookPage>
        </section>

        <div className="mt-10 text-center">
          <Button asChild size="lg" className="min-h-12 bg-[#A94E36] text-white hover:bg-[#8F3F2C]">
            <a href="/#probeer-buildy">Probeer met je bouwfoto <ArrowRight aria-hidden="true" /></a>
          </Button>
        </div>
      </div>
    </main>
  );
};
