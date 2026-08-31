import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock3, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ApiClientError } from "@/lib/apiClient";
import {
  forgetPendingProjectShareToken,
  pendingProjectShareTokenValue,
} from "@/lib/projectShareFragment";
import { redeemProjectShareLink } from "@/lib/projectShareApi";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link } from "@/lib/router";

type RedeemState = "redeeming" | "expired" | "unavailable" | "invalid" | "retry";

const ShareLinkRedeem = () => {
  const [state, setState] = useState<RedeemState>(() => (
    pendingProjectShareTokenValue() ? "redeeming" : "invalid"
  ));
  const started = useRef(false);

  usePageMeta({
    title: "Deellink openen — Buildy",
    description: "Open tijdelijke kijktoegang tot een Buildy-verbouwing.",
    path: "/delen",
    noIndex: true,
  });

  const redeem = useCallback(async () => {
    const token = pendingProjectShareTokenValue();
    if (!token) {
      setState("invalid");
      return;
    }
    setState("redeeming");
    try {
      const result = await redeemProjectShareLink(token);
      forgetPendingProjectShareToken();
      window.location.replace(result.cleanPath);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 410) {
        forgetPendingProjectShareToken();
        setState("expired");
        return;
      }
      if (error instanceof ApiClientError && [400, 404].includes(error.status)) {
        forgetPendingProjectShareToken();
        setState(error.status === 400 ? "invalid" : "unavailable");
        return;
      }
      setState("retry");
    }
  }, []);

  useEffect(() => {
    if (started.current || state === "invalid") return;
    started.current = true;
    void redeem();
  }, [redeem, state]);

  const retry = () => {
    started.current = true;
    void redeem();
  };

  const presentation = state === "expired"
    ? {
        icon: Clock3,
        eyebrow: "Toegang verlopen",
        title: "Deze deel-link is niet meer actief.",
        description: "Vraag de maker van de verbouwing om een nieuwe tijdelijke link.",
      }
    : state === "unavailable"
      ? {
          icon: AlertTriangle,
          eyebrow: "Toegang gestopt",
          title: "De eigenaar heeft deze deel-link ingetrokken.",
          description: "Vraag de eigenaar om een nieuwe link wanneer je weer wilt meekijken.",
        }
      : state === "invalid"
        ? {
            icon: AlertTriangle,
            eyebrow: "Ongeldige link",
            title: "Deze deellink is niet compleet.",
            description: "Open de volledige link die je van de maker hebt ontvangen.",
          }
        : state === "retry"
          ? {
              icon: AlertTriangle,
              eyebrow: "Verbinding onderbroken",
              title: "De deellink kon niet worden gecontroleerd.",
              description: "De geheime link staat nog veilig in dit tabblad. Probeer de controle opnieuw.",
            }
          : null;

  return (
    <main className="min-h-[72vh] bg-background px-4 py-14 sm:px-6 sm:py-20" aria-live="polite">
      <div className="mx-auto max-w-2xl border-y border-border py-10 sm:py-14">
        {state === "redeeming" ? (
          <div className="text-center" role="status">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-accent/30 bg-secondary text-accent">
              <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            </div>
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Tijdelijke toegang</p>
            <h1 className="mt-3 font-serif text-3xl sm:text-4xl">Deellink veilig openen…</h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              Buildy wisselt de link om voor alleen-lezen toegang en haalt het geheim direct uit je adresbalk.
            </p>
          </div>
        ) : presentation ? (
          <div className="text-center" role="alert">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
              <presentation.icon className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{presentation.eyebrow}</p>
            <h1 className="mt-3 font-serif text-3xl sm:text-4xl">{presentation.title}</h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">{presentation.description}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {state === "retry" ? (
                <Button type="button" className="min-h-11 gap-2" onClick={retry}>
                  <KeyRound className="h-4 w-4" aria-hidden="true" /> Opnieuw controleren
                </Button>
              ) : null}
              <Button asChild variant="outline" className="min-h-11">
                <Link to={PRODUCT_ROUTES.landing}>Naar Buildy</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
};

export default ShareLinkRedeem;
