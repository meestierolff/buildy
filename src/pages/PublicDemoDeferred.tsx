import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useLocation } from "@/lib/router";

const PublicDemoDeferred = () => {
  const { pathname } = useLocation();
  usePageMeta({
    title: "Persoonlijke accounts volgen later — Buildy",
    description: "Bekijk nu de openbare Buildy-demo zonder account.",
    path: pathname,
    noIndex: true,
  });

  return (
    <main className="flex min-h-[65vh] items-center bg-[#F7F2E9] px-4 py-16 sm:px-6 md:px-8">
      <div className="mx-auto w-full max-w-3xl border-y border-[#D8CFC1] py-12 text-center sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">
          Openbare demo
        </p>
        <h1 className="mx-auto mt-4 max-w-2xl font-serif text-4xl leading-[0.98] text-[#26231F] sm:text-5xl">
          Persoonlijke accounts openen later in de bèta.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-[#655F57] sm:text-base sm:leading-7">
          Probeer nu met een foto op je eigen apparaat of bekijk de volledig verzonnen voorbeeldverbouwing.
        </p>
        <Button asChild size="lg" className="mt-8 min-h-12 bg-[#A94E36] px-6 text-white hover:bg-[#8F3F2C]">
          <a href="/#probeer-buildy">
            <ArrowLeft aria-hidden="true" /> Terug naar de demo
          </a>
        </Button>
      </div>
    </main>
  );
};

export default PublicDemoDeferred;
