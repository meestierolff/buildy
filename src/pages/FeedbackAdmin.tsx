import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Inbox, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type {
  FeedbackAdminKind,
  FeedbackAdminStatus,
} from "../../shared/contracts/feedbackAdmin";
import type { ModerationAdminRole } from "../../shared/contracts/moderation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import {
  useFeedbackAdminDetail,
  useFeedbackAdminSession,
  useFeedbackAdminStatusMutation,
  useInfiniteFeedbackAdminQueue,
} from "@/hooks/useFeedbackAdmin";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { Link, Navigate, useParams } from "@/lib/router";

const STATUS_LABELS: Record<FeedbackAdminStatus, string> = {
  new: "Nieuw",
  triaged: "In behandeling",
  planned: "Gepland",
  resolved: "Opgelost",
  closed: "Gesloten",
};

const KIND_LABELS: Record<FeedbackAdminKind, string> = {
  feedback: "Feedback",
  support: "Support",
  third_party_request: "Verzoek van derde",
  appeal: "Bezwaar",
};

const NEXT_STATUSES: Record<FeedbackAdminStatus, readonly FeedbackAdminStatus[]> = {
  new: ["triaged"],
  triaged: ["planned", "resolved", "closed"],
  planned: ["triaged", "resolved", "closed"],
  resolved: ["triaged", "closed"],
  closed: [],
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function AccessBoundary({ children }: { children: (role: ModerationAdminRole) => ReactNode }) {
  const { user, loading } = useAuth();
  const session = useFeedbackAdminSession(Boolean(user) && !loading);

  if (loading) return <div className="py-20 text-center" role="status">Sessie controleren…</div>;
  if (!user) return <Navigate to="/auth?next=%2Fbeheer%2Ffeedback" replace />;
  if (session.isPending) {
    return <div className="py-20 text-center" role="status">Beheerrol controleren…</div>;
  }
  if (session.isError) {
    const denied = session.error instanceof ApiClientError
      && (session.error.status === 401 || session.error.status === 403);
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Alert variant={denied ? "default" : "destructive"}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{denied ? "Geen toegang" : "Autorisatie niet beschikbaar"}</AlertTitle>
          <AlertDescription>
            <p>{denied
              ? "Voor deze omgeving is een actieve beheerrol nodig."
              : "De rolcontrole kon niet veilig worden voltooid. Probeer het opnieuw."}</p>
            {!denied ? (
              <Button className="mt-3" size="sm" variant="outline" onClick={() => session.refetch()}>
                <RefreshCw aria-hidden="true" /> Opnieuw proberen
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  return <>{children(session.data.role)}</>;
}

function Queue() {
  const [status, setStatus] = useState<FeedbackAdminStatus>("new");
  const [kind, setKind] = useState<FeedbackAdminKind | "all">("all");
  const queue = useInfiniteFeedbackAdminQueue({
    status,
    kind: kind === "all" ? undefined : kind,
    limit: 25,
  });
  const items = useMemo(() => queue.data?.pages.flatMap((page) => page.items) ?? [], [queue.data]);

  return (
    <>
      <header className="border-b border-border pb-6">
        <p className="eyebrow flex items-center gap-2"><Inbox className="h-4 w-4" aria-hidden="true" /> Beheer</p>
        <h1 className="mt-3 font-serif text-4xl">Feedback &amp; support</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Deze wachtrij toont alleen noodzakelijke metadata. Bericht en contactgegevens worden pas
          na autorisatie op de detailpagina ontsleuteld.
        </p>
      </header>

      <section className="grid gap-4 border-b border-border py-6 sm:grid-cols-2" aria-label="Wachtrijfilters">
        <div>
          <Label htmlFor="feedback-admin-status">Status</Label>
          <select
            id="feedback-admin-status"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as FeedbackAdminStatus)}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="feedback-admin-kind">Type</Label>
          <select
            id="feedback-admin-kind"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as FeedbackAdminKind | "all")}
          >
            <option value="all">Alle typen</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="py-6" aria-label="Inzendingen">
        {queue.isPending ? (
          <p className="py-16 text-center text-muted-foreground" role="status">Inzendingen laden…</p>
        ) : queue.isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Wachtrij kon niet worden geladen</AlertTitle>
            <AlertDescription>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => queue.refetch()}>
                Opnieuw proberen
              </Button>
            </AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <div className="border border-dashed border-border px-6 py-16 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-3 font-medium">Geen inzendingen in deze wachtrij</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pas de filters aan of controleer later opnieuw.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/beheer/feedback/${item.id}`}
                  className="grid gap-3 px-3 py-5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[1fr_auto] sm:px-5"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{item.receiptCode}</span>
                      <Badge variant="outline">{KIND_LABELS[item.kind]}</Badge>
                      {item.hasContact ? <Badge variant="secondary">Contact beschikbaar</Badge> : null}
                    </div>
                    <p className="mt-2 font-medium">{item.category}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Ontvangen {formatDate(item.createdAt)}</p>
                  </div>
                  <span className="self-center text-sm font-medium text-accent">Open inzending</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {queue.hasNextPage ? (
          <div className="mt-6 text-center">
            <Button
              variant="outline"
              disabled={queue.isFetchingNextPage}
              onClick={() => queue.fetchNextPage()}
            >
              {queue.isFetchingNextPage ? "Meer laden…" : "Meer inzendingen"}
            </Button>
          </div>
        ) : null}
      </section>
    </>
  );
}

function Detail({ submissionId, role }: { submissionId: string; role: ModerationAdminRole }) {
  const detail = useFeedbackAdminDetail(submissionId);
  const mutation = useFeedbackAdminStatusMutation(submissionId);
  const [targetStatus, setTargetStatus] = useState<FeedbackAdminStatus | "">("");
  const pendingKey = useRef<string | null>(null);
  const pendingPayload = useRef<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!detail.data || !targetStatus || mutation.isPending) return;
    const fingerprint = `${detail.data.version}:${targetStatus}`;
    if (pendingPayload.current !== fingerprint) {
      pendingPayload.current = fingerprint;
      pendingKey.current = createClientIdempotencyKey("feedback-review");
    }
    try {
      await mutation.mutateAsync({
        idempotencyKey: pendingKey.current!,
        expectedVersion: detail.data.version,
        status: targetStatus,
      });
      toast.success("De statuswijziging is vastgelegd.");
      setTargetStatus("");
      pendingKey.current = null;
      pendingPayload.current = null;
    } catch (error) {
      console.error("Feedback review failed", error instanceof Error ? error.name : "UnknownError");
      toast.error(error instanceof ApiClientError ? error.message : "De status kon niet worden bijgewerkt.");
    }
  }

  if (detail.isPending) {
    return <p className="py-16 text-center" role="status">Inzending veilig ontsleutelen…</p>;
  }
  if (detail.isError || !detail.data) {
    const denied = detail.error instanceof ApiClientError
      && (detail.error.status === 401 || detail.error.status === 403);
    return (
      <Alert variant={denied ? "default" : "destructive"}>
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{denied ? "Geen toegang" : "Inzending kon niet worden geopend"}</AlertTitle>
        <AlertDescription>
          {!denied ? (
            <Button className="mt-3" size="sm" variant="outline" onClick={() => detail.refetch()}>
              Opnieuw proberen
            </Button>
          ) : "Je actieve beheerrol geeft geen toegang tot deze inzending."}
        </AlertDescription>
      </Alert>
    );
  }

  const nextStatuses = NEXT_STATUSES[detail.data.status];
  return (
    <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
      <article className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{STATUS_LABELS[detail.data.status]}</Badge>
          <Badge variant="secondary">{KIND_LABELS[detail.data.kind]}</Badge>
          <Badge variant="outline">{role}</Badge>
        </div>
        <h1 className="mt-4 font-serif text-4xl">{detail.data.receiptCode}</h1>
        <dl className="mt-6 grid gap-4 border-y border-border py-5 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Categorie</dt><dd className="mt-1 font-medium">{detail.data.category}</dd></div>
          <div><dt className="text-muted-foreground">Ontvangen</dt><dd className="mt-1">{formatDate(detail.data.createdAt)}</dd></div>
          <div><dt className="text-muted-foreground">Inzender</dt><dd className="mt-1">{detail.data.authenticated ? "Ingelogd" : "Niet ingelogd"}</dd></div>
          <div><dt className="text-muted-foreground">Versie</dt><dd className="mt-1">{detail.data.version}</dd></div>
        </dl>

        <section className="mt-8" aria-labelledby="feedback-message-heading">
          <h2 id="feedback-message-heading" className="font-serif text-2xl">Bericht</h2>
          <p className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 text-sm leading-6">
            {detail.data.message}
          </p>
        </section>

        <section className="mt-8" aria-labelledby="feedback-contact-heading">
          <h2 id="feedback-contact-heading" className="flex items-center gap-2 font-serif text-2xl">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" /> Contact
          </h2>
          <p className="mt-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
            {detail.data.contactEmail ?? "Geen contactadres opgegeven."}
          </p>
        </section>

        <section className="mt-8" aria-labelledby="feedback-history-heading">
          <h2 id="feedback-history-heading" className="font-serif text-2xl">Beoordelingsgeschiedenis</h2>
          {detail.data.reviews.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nog geen statuswijzigingen vastgelegd.</p>
          ) : (
            <ol className="mt-3 divide-y divide-border border-y border-border">
              {detail.data.reviews.map((review) => (
                <li key={review.id} className="py-4 text-sm">
                  <p className="font-medium">
                    {STATUS_LABELS[review.fromStatus]} → {STATUS_LABELS[review.toStatus]}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(review.createdAt)} · {review.actorRole} · versie {review.submissionVersion}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </article>

      <aside>
        <form className="sticky top-24 rounded-md border border-border bg-card p-5" onSubmit={submit}>
          <h2 className="font-serif text-2xl">Status bijwerken</h2>
          {nextStatuses.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Deze inzending is definitief gesloten.</p>
          ) : (
            <>
              <div className="mt-5">
                <Label htmlFor="feedback-next-status">Nieuwe status</Label>
                <select
                  id="feedback-next-status"
                  required
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={targetStatus}
                  onChange={(event) => setTargetStatus(event.target.value as FeedbackAdminStatus | "")}
                >
                  <option value="">Kies een status</option>
                  {nextStatuses.map((status) => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </div>
              <Button className="mt-5 w-full" type="submit" disabled={!targetStatus || mutation.isPending}>
                {mutation.isPending ? "Status vastleggen…" : "Status bevestigen"}
              </Button>
            </>
          )}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Elke wijziging gebruikt de verwachte versie en wordt met actor en tijdstip append-only geaudit.
          </p>
        </form>
      </aside>
    </div>
  );
}

function FeedbackAdminContent({ role }: { role: ModerationAdminRole }) {
  const { submissionId } = useParams<{ submissionId?: string }>();
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 md:py-14">
      {submissionId ? (
        <>
          <Link to="/beheer/feedback" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-accent underline-offset-4 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Terug naar de wachtrij
          </Link>
          <Detail submissionId={submissionId} role={role} />
        </>
      ) : <Queue />}
    </main>
  );
}

const FeedbackAdmin = () => {
  usePageMeta({
    title: "Feedback & support — Buildy",
    description: "Afgeschermde feedback- en supportomgeving van Buildy.",
    path: "/beheer/feedback",
    noIndex: true,
  });
  return <AccessBoundary>{(role) => <FeedbackAdminContent role={role} />}</AccessBoundary>;
};

export default FeedbackAdmin;
