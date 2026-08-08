import { Link, useNavigate } from "@/lib/router";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAccessMutation, useSocialProjectState } from "@/hooks/useSocial";
import { Button } from "@/components/ui/button";
import { Check, Clock, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

interface Props {
  projectId: string;
}

const RequestAccessCard = ({ projectId }: Props) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mutation = useProjectAccessMutation();
  const stateQuery = useSocialProjectState(projectId, Boolean(user && projectId));
  const accessState = stateQuery.data?.accessStatus;

  const request = async () => {
    if (!user) {
      navigate(authPagePath(PRODUCT_ROUTES.project(projectId)));
      return;
    }
    try {
      const result = await mutation.mutateAsync({ action: "request", projectId });
      if (result.state === "accepted") {
        toast.success("Je hebt toegang tot dit project");
        return;
      }
      if (result.state === "pending") {
        toast.success("Verzoek verstuurd — de eigenaar krijgt een melding");
        return;
      }
      toast.error("Toegang aanvragen is niet mogelijk");
    } catch (error) {
      console.error("Project access request failed", error);
      toast.error("Verzoek kon niet worden verstuurd");
    }
  };

  const cancelRequest = async () => {
    try {
      await mutation.mutateAsync({ action: "cancel", projectId });
      toast.success("Verzoek ingetrokken");
    } catch (error) {
      console.error("Project access cancellation failed", error);
      toast.error("Verzoek kon niet worden ingetrokken");
    }
  };

  return (
    <main className="container py-20 flex justify-center">
      <section className="max-w-md w-full rounded-xl border bg-card p-8 text-center space-y-4 shadow-sm" aria-labelledby="private-project-title">
        <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 id="private-project-title" className="text-xl font-serif font-semibold">Privéproject</h1>
          <p className="text-sm text-muted-foreground">
            Dit project is niet openbaar. Om privacyredenen tonen we pas details nadat toegang is verleend.
          </p>
        </div>

        {!user ? (
          <Button className="w-full" onClick={() => navigate(authPagePath(PRODUCT_ROUTES.project(projectId)))}>
            Inloggen om toegang aan te vragen
          </Button>
        ) : stateQuery.isPending ? (
          <Button disabled className="w-full gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Toegangsstatus laden
          </Button>
        ) : stateQuery.isError ? (
          <Button className="w-full" variant="outline" onClick={() => void stateQuery.refetch()}>
            Probeer opnieuw
          </Button>
        ) : accessState === "accepted" ? (
          <Button className="w-full gap-2" onClick={() => window.location.reload()}>
            <Check className="h-4 w-4" aria-hidden="true" /> Toegang verleend — herladen
          </Button>
        ) : accessState === "pending" ? (
          <Button disabled={mutation.isPending} onClick={cancelRequest} className="w-full gap-2" variant="secondary">
            {mutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Clock className="h-4 w-4" aria-hidden="true" />}
            Verzoek intrekken
          </Button>
        ) : (
          <Button disabled={mutation.isPending || !projectId} onClick={request} className="w-full gap-2">
            {mutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Lock className="h-4 w-4" aria-hidden="true" />}
            Vraag toegang
          </Button>
        )}

        <p className="sr-only" role="status" aria-live="polite">
          {mutation.isPending ? "Verzoek wordt verwerkt" : ""}
        </p>
        <Link to={PRODUCT_ROUTES.discover} className="block text-xs text-muted-foreground underline">
          Terug naar overzicht
        </Link>
      </section>
    </main>
  );
};

export default RequestAccessCard;
