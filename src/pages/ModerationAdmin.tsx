import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, EyeOff, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type {
  ModerationAdminActionInput,
  ModerationAdminActionKind,
  ModerationAdminRole,
  ModerationReportStatus,
  ModerationTargetType,
  ModerationUrgency,
} from "../../shared/contracts/moderation";
import { MODERATION_REASON_LABELS } from "../../shared/contracts/moderation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  useInfiniteModerationAdminQueue,
  useModerationAdminActionMutation,
  useModerationAdminReport,
  useModerationAdminSession,
} from "@/hooks/useModeration";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { Link, Navigate, useParams } from "@/lib/router";

const STATUS_LABELS: Record<ModerationReportStatus, string> = {
  open: "Open",
  triaged: "Beoordeeld",
  investigating: "In onderzoek",
  resolved: "Afgehandeld",
  dismissed: "Gesloten zonder maatregel",
};

const URGENCY_LABELS: Record<ModerationUrgency, string> = {
  normal: "Normaal",
  high: "Hoog",
  urgent: "Urgent",
};

const TARGET_LABELS: Record<ModerationTargetType, string> = {
  profile: "Profiel",
  project: "Verbouwing",
  update: "Bouwmoment",
  media: "Media",
  comment: "Reactie",
};

const ACTION_LABELS: Record<ModerationAdminActionKind, string> = {
  hide: "Inhoud verbergen",
  restore: "Eerdere maatregel herstellen",
  warn: "Waarschuwing sturen",
  suspend: "Account schorsen",
  block: "Account blokkeren",
  dismiss: "Melding afwijzen",
  resolve: "Melding afhandelen",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function AccessBoundary({ children }: { children: (role: ModerationAdminRole) => ReactNode }) {
  const { user, loading } = useAuth();
  const session = useModerationAdminSession(Boolean(user) && !loading);

  if (loading) {
    return <main className="py-20 text-center" role="status">Sessie controleren…</main>;
  }
  if (!user) {
    return <Navigate to="/auth?next=%2Fbeheer%2Fmoderatie" replace />;
  }
  if (session.isPending) {
    return <main className="py-20 text-center" role="status">Moderatierol controleren…</main>;
  }
  if (session.isError) {
    const forbidden = session.error instanceof ApiClientError
      && (session.error.status === 401 || session.error.status === 403);
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Alert variant={forbidden ? "default" : "destructive"}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{forbidden ? "Geen toegang" : "Autorisatie niet beschikbaar"}</AlertTitle>
          <AlertDescription>
            <p>{forbidden
              ? "Voor deze omgeving is een actieve moderator- of beheerrol nodig."
              : "De rolcontrole kon niet veilig worden voltooid. Probeer het opnieuw."}</p>
            {!forbidden ? (
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
  const [status, setStatus] = useState<ModerationReportStatus>("open");
  const [urgency, setUrgency] = useState<ModerationUrgency | "all">("all");
  const [targetType, setTargetType] = useState<ModerationTargetType | "all">("all");
  const queue = useInfiniteModerationAdminQueue({
    status,
    urgency: urgency === "all" ? undefined : urgency,
    targetType: targetType === "all" ? undefined : targetType,
    limit: 25,
  });
  const items = useMemo(() => queue.data?.pages.flatMap((page) => page.items) ?? [], [queue.data]);

  return (
    <>
      <header className="border-b border-border pb-6">
        <p className="eyebrow flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Beheer</p>
        <h1 className="mt-3 font-serif text-4xl">Moderatiewachtrij</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          De lijst bevat alleen operationele metadata. Inhoud en toelichting worden pas op de
          geautoriseerde detailroute ontsleuteld.
        </p>
      </header>

      <section className="grid gap-4 border-b border-border py-6 sm:grid-cols-3" aria-label="Wachtrijfilters">
        <div>
          <Label htmlFor="moderation-status">Status</Label>
          <select
            id="moderation-status"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as ModerationReportStatus)}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="moderation-urgency">Urgentie</Label>
          <select
            id="moderation-urgency"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={urgency}
            onChange={(event) => setUrgency(event.target.value as ModerationUrgency | "all")}
          >
            <option value="all">Alle urgenties</option>
            {Object.entries(URGENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="moderation-target">Type inhoud</Label>
          <select
            id="moderation-target"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={targetType}
            onChange={(event) => setTargetType(event.target.value as ModerationTargetType | "all")}
          >
            <option value="all">Alle typen</option>
            {Object.entries(TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </section>

      <section className="py-6" aria-label="Meldingen">
        {queue.isPending ? (
          <p className="py-16 text-center text-muted-foreground" role="status">Meldingen laden…</p>
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
            <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-3 font-medium">Geen meldingen in deze wachtrij</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pas de filters aan of controleer later opnieuw.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/beheer/moderatie/${item.id}`}
                  className="grid gap-3 px-3 py-5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[1fr_auto] sm:px-5"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{item.receiptCode}</span>
                      <Badge variant={item.urgency === "urgent" ? "destructive" : "outline"}>
                        {URGENCY_LABELS[item.urgency]}
                      </Badge>
                      {item.targetHidden ? <Badge variant="secondary"><EyeOff aria-hidden="true" className="mr-1 h-3 w-3" /> Verborgen</Badge> : null}
                    </div>
                    <p className="mt-2 font-medium">{TARGET_LABELS[item.targetType]} · {MODERATION_REASON_LABELS[item.reason]}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Ontvangen {formatDate(item.createdAt)}</p>
                  </div>
                  <span className="self-center text-sm font-medium text-accent">Open melding</span>
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
              {queue.isFetchingNextPage ? "Meer laden…" : "Meer meldingen"}
            </Button>
          </div>
        ) : null}
      </section>
    </>
  );
}

function ActionForm({ reportId, role }: { reportId: string; role: ModerationAdminRole }) {
  const report = useModerationAdminReport(reportId);
  const action = useModerationAdminActionMutation(reportId);
  const [kind, setKind] = useState<ModerationAdminActionKind>("resolve");
  const [reason, setReason] = useState("");
  const [reverseActionId, setReverseActionId] = useState("");
  const pendingKey = useRef<string | null>(null);
  const pendingPayload = useRef<string | null>(null);
  const reversibleActions = report.data?.actions.filter((item) =>
    ["hide", "suspend", "block"].includes(item.kind) && !item.reversedByActionId) ?? [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!report.data || action.isPending) return;
    const payloadFingerprint = JSON.stringify({ kind, reason: reason.trim(), reverseActionId });
    if (pendingPayload.current !== payloadFingerprint) {
      pendingPayload.current = payloadFingerprint;
      pendingKey.current = createClientIdempotencyKey("moderation-action");
    }
    const input: ModerationAdminActionInput = {
      idempotencyKey: pendingKey.current!,
      expectedReportVersion: report.data.version,
      kind,
      reason: reason.trim(),
      ...(kind === "restore" ? { reverseActionId } : {}),
    };
    try {
      await action.mutateAsync(input);
      toast.success("Moderatieactie is vastgelegd.");
      setReason("");
      setReverseActionId("");
      pendingKey.current = null;
      pendingPayload.current = null;
    } catch (error) {
      console.error("Moderation action failed", error instanceof Error ? error.name : "UnknownError");
      toast.error(error instanceof ApiClientError ? error.message : "De actie kon niet worden vastgelegd.");
    }
  }

  if (report.isPending) return <p className="py-16 text-center" role="status">Melding ontsleutelen…</p>;
  if (report.isError || !report.data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Melding kon niet worden geopend</AlertTitle>
        <AlertDescription>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => report.refetch()}>Opnieuw proberen</Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
      <article className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{STATUS_LABELS[report.data.status]}</Badge>
          <Badge variant={report.data.urgency === "urgent" ? "destructive" : "outline"}>{URGENCY_LABELS[report.data.urgency]}</Badge>
          {report.data.targetHidden ? <Badge variant="secondary">Verborgen</Badge> : null}
        </div>
        <h1 className="mt-4 font-serif text-4xl">{report.data.receiptCode}</h1>
        <dl className="mt-6 grid gap-4 border-y border-border py-5 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Inhoud</dt><dd className="mt-1 font-medium">{TARGET_LABELS[report.data.targetType]}</dd></div>
          <div><dt className="text-muted-foreground">Reden</dt><dd className="mt-1 font-medium">{MODERATION_REASON_LABELS[report.data.reason]}</dd></div>
          <div><dt className="text-muted-foreground">Ontvangen</dt><dd className="mt-1">{formatDate(report.data.createdAt)}</dd></div>
          <div><dt className="text-muted-foreground">Versie</dt><dd className="mt-1">{report.data.version}</dd></div>
        </dl>

        <section className="mt-8" aria-labelledby="report-details-heading">
          <h2 id="report-details-heading" className="font-serif text-2xl">Toelichting</h2>
          <p className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 text-sm leading-6">
            {report.data.details ?? "Geen aanvullende toelichting opgegeven."}
          </p>
        </section>
        <section className="mt-8" aria-labelledby="report-snapshot-heading">
          <h2 id="report-snapshot-heading" className="font-serif text-2xl">Vastgelegde inhoud</h2>
          <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-4 text-xs leading-5">
            {JSON.stringify(report.data.targetSnapshot, null, 2)}
          </pre>
        </section>
        <section className="mt-8" aria-labelledby="report-actions-heading">
          <h2 id="report-actions-heading" className="font-serif text-2xl">Actiegeschiedenis</h2>
          {report.data.actions.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nog geen acties vastgelegd.</p>
          ) : (
            <ol className="mt-3 divide-y divide-border border-y border-border">
              {report.data.actions.map((item) => (
                <li key={item.id} className="py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{ACTION_LABELS[item.kind]}</span>
                    <Badge variant="outline">{item.actorRole}</Badge>
                    {item.reversedByActionId ? <Badge variant="secondary">Teruggedraaid</Badge> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.reason}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{formatDate(item.createdAt)} · versie {item.reportVersion}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </article>

      <aside>
        <form className="sticky top-24 rounded-md border border-border bg-card p-5" onSubmit={submit}>
          <h2 className="font-serif text-2xl">Actie vastleggen</h2>
          <div className="mt-5">
            <Label htmlFor="moderation-action-kind">Actie</Label>
            <select
              id="moderation-action-kind"
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as ModerationAdminActionKind);
                setReverseActionId("");
              }}
            >
              {(Object.keys(ACTION_LABELS) as ModerationAdminActionKind[])
                .filter((value) => role === "admin" || !["suspend", "block"].includes(value))
                .map((value) => <option key={value} value={value}>{ACTION_LABELS[value]}</option>)}
            </select>
          </div>
          {kind === "restore" ? (
            <div className="mt-4">
              <Label htmlFor="moderation-reverse-action">Terug te draaien actie</Label>
              <select
                id="moderation-reverse-action"
                required
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={reverseActionId}
                onChange={(event) => setReverseActionId(event.target.value)}
              >
                <option value="">Kies een actie</option>
                {reversibleActions.map((item) => (
                  <option key={item.id} value={item.id}>{ACTION_LABELS[item.kind]} · {formatDate(item.createdAt)}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="mt-4">
            <Label htmlFor="moderation-action-reason">Motivering</Label>
            <Textarea
              id="moderation-action-reason"
              className="mt-2 min-h-32"
              required
              minLength={3}
              maxLength={1_000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Leg feitelijk vast waarom deze actie passend is. Vermijd onnodige persoonsgegevens."
            />
          </div>
          <Button className="mt-5 w-full" type="submit" disabled={action.isPending || (kind === "restore" && !reverseActionId)}>
            {action.isPending ? "Actie vastleggen…" : "Actie bevestigen"}
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Elke actie gebruikt een opdracht-ID, een verwachte rapportversie en een append-only audit-event.
          </p>
        </form>
      </aside>
    </div>
  );
}

function ModerationAdminContent({ role }: { role: ModerationAdminRole }) {
  const { reportId } = useParams<{ reportId?: string }>();
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 md:py-14">
      {reportId ? (
        <>
          <Link to="/beheer/moderatie" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-accent underline-offset-4 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Terug naar de wachtrij
          </Link>
          <ActionForm reportId={reportId} role={role} />
        </>
      ) : <Queue />}
    </main>
  );
}

const ModerationAdmin = () => {
  usePageMeta({
    title: "Moderatiewachtrij — Buildy",
    description: "Afgeschermde moderatieomgeving van Buildy.",
    path: "/beheer/moderatie",
    noIndex: true,
  });
  return <AccessBoundary>{(role) => <ModerationAdminContent role={role} />}</AccessBoundary>;
};

export default ModerationAdmin;
