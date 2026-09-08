import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Download,
  Loader2,
  PackageCheck,
  RefreshCcw,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AdminOrderActionInput,
  AdminOrderDetail,
  ManualFulfilmentAction,
  ManualFulfilmentStatus,
} from "../../shared/contracts/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  useAdminOrder,
  useAdminOrderActionMutation,
  useInfiniteAdminOrderQueue,
} from "@/hooks/useOrderAdmin";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ApiClientError } from "@/lib/apiClient";
import { Link, Navigate, useParams } from "@/lib/router";

const STATUS_LABELS: Record<ManualFulfilmentStatus, string> = {
  awaiting_review: "Te controleren",
  reviewed: "Gecontroleerd",
  ordered_manually: "Handmatig besteld",
  in_production: "In productie",
  shipped: "Verzonden",
  completed: "Afgerond",
  manual_review: "Handmatige aandacht",
  cancelled: "Geannuleerd",
  refund_review: "Terugbetaling beoordelen",
};

const ACTION_LABELS: Record<ManualFulfilmentAction, string> = {
  review: "Markeer als gecontroleerd",
  ordered_manually: "Leg handmatige bestelling vast",
  mark_in_production: "Markeer als in productie",
  mark_shipped: "Markeer als verzonden",
  mark_completed: "Markeer als afgerond",
  manual_review: "Markeer voor handmatige controle",
  cancel: "Leg annulering vast",
  refund_review: "Markeer voor terugbetalingscontrole",
  update_details: "Werk notitie en referenties bij",
};

const FILTERS: Array<"all" | ManualFulfilmentStatus> = [
  "all",
  "awaiting_review",
  "reviewed",
  "ordered_manually",
  "in_production",
  "shipped",
  "completed",
  "manual_review",
  "refund_review",
  "cancelled",
];

function money(minor: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(minor / 100);
}

function dateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorStatus(error: unknown): number | null {
  return error instanceof ApiClientError ? error.status : null;
}

function availableActions(order: AdminOrderDetail): ManualFulfilmentAction[] {
  const detail: ManualFulfilmentAction[] = ["update_details", "manual_review", "refund_review"];
  switch (order.fulfilmentStatus) {
    case "awaiting_review": return ["review", ...detail, "cancel"];
    case "reviewed": return ["ordered_manually", ...detail, "cancel"];
    case "ordered_manually": return ["mark_in_production", ...detail, "cancel"];
    case "in_production": return ["mark_shipped", ...detail, "cancel"];
    case "shipped": return ["mark_completed", ...detail];
    case "manual_review":
    case "refund_review": return ["review", "update_details", "cancel"];
    case "completed": return ["update_details", "refund_review", "manual_review"];
    case "cancelled": return ["update_details", "refund_review"];
  }
}

const AccessState = ({ status, retry }: { status: number | null; retry: () => void }) => (
  <section className="mx-auto max-w-xl px-5 py-24 text-center" aria-labelledby="admin-access-title">
    <PackageCheck className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
    <h1 className="mt-5 text-2xl font-semibold" id="admin-access-title">
      Bestellingbeheer niet beschikbaar
    </h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground" role="alert">
      {status === 403
        ? "Deze omgeving is alleen beschikbaar voor een actief Buildy-beheeraccount."
        : "De beveiligde bestellijst kon niet worden geladen."}
    </p>
    {status !== 403 ? <Button className="mt-6" onClick={retry} variant="outline"><RefreshCcw /> Opnieuw proberen</Button> : null}
  </section>
);

const OrderList = () => {
  const [status, setStatus] = useState<"all" | ManualFulfilmentStatus>("all");
  const queue = useInfiniteAdminOrderQueue({ status, limit: 30 });
  const items = useMemo(
    () => queue.data?.pages.flatMap((page) => page.items) ?? [],
    [queue.data?.pages],
  );

  if (queue.isError) return <AccessState status={errorStatus(queue.error)} retry={() => queue.refetch()} />;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="border-b border-border pb-7 md:flex md:items-end md:justify-between md:gap-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Founder operations</p>
          <h1 className="mt-2 text-3xl font-semibold">Betaalde Bouwboeken</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Controleer de exacte printversie en leg iedere handmatige productie- en verzendstap vast.
          </p>
        </div>
        <div className="mt-5 w-full md:mt-0 md:w-64">
          <Label htmlFor="order-status-filter">Status</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger className="mt-2 min-h-11" id="order-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FILTERS.map((item) => (
                <SelectItem key={item} value={item}>{item === "all" ? "Alle betaalde orders" : STATUS_LABELS[item]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {queue.isPending ? (
        <div className="flex min-h-64 items-center justify-center" role="status"><Loader2 className="animate-spin" /><span className="sr-only">Bestellingen laden…</span></div>
      ) : items.length === 0 ? (
        <section className="py-20 text-center">
          <BookOpen className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold">Geen bestellingen in deze status</h2>
          <p className="mt-2 text-sm text-muted-foreground">Nieuwe betaalde orders verschijnen hier automatisch na een geverifieerde Stripe-webhook.</p>
        </section>
      ) : (
        <div className="mt-7 overflow-x-auto border-y border-border">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Order</th>
                <th className="px-4 py-3 font-semibold">Klant / verbouwing</th>
                <th className="px-4 py-3 font-semibold">Betaald</th>
                <th className="px-4 py-3 font-semibold">Boek</th>
                <th className="px-4 py-3 font-semibold">Totaal</th>
                <th className="px-4 py-3 font-semibold">Fulfilment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((order) => (
                <tr className="bg-background hover:bg-muted/20" key={order.orderId}>
                  <td className="px-4 py-4 font-mono text-xs"><Link className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" to={`/beheer/bestellingen/${order.orderId}`}>{order.orderNumber}</Link></td>
                  <td className="px-4 py-4"><span className="font-medium">{order.customerName}</span><br /><span className="text-muted-foreground">{order.projectTitle}</span></td>
                  <td className="px-4 py-4">{dateTime(order.paidAt)}</td>
                  <td className="px-4 py-4">{order.quantity} × {order.pageCount} pagina’s</td>
                  <td className="px-4 py-4 font-medium">{money(order.totalMinor)}</td>
                  <td className="px-4 py-4"><span className={order.needsAttention ? "font-semibold text-amber-700" : ""}>{STATUS_LABELS[order.fulfilmentStatus]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {queue.hasNextPage ? (
        <div className="mt-7 text-center">
          <Button disabled={queue.isFetchingNextPage} onClick={() => queue.fetchNextPage()} variant="outline">
            {queue.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null} Meer bestellingen
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const OrderDetail = ({ orderId }: { orderId: string }) => {
  const orderQuery = useAdminOrder(orderId);
  const mutation = useAdminOrderActionMutation(orderId);
  const order = orderQuery.data;
  const [action, setAction] = useState<ManualFulfilmentAction>("update_details");
  const [externalReference, setExternalReference] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!order) return;
    setExternalReference(order.manualProviderReference ?? "");
    setTrackingUrl(order.trackingUrl ?? "");
    setNotes(order.fulfilmentNotes ?? "");
    setAction(availableActions(order)[0] ?? "update_details");
  }, [order]);

  if (orderQuery.isError) return <AccessState status={errorStatus(orderQuery.error)} retry={() => orderQuery.refetch()} />;
  if (orderQuery.isPending || !order) {
    return <div className="flex min-h-[60vh] items-center justify-center" role="status"><Loader2 className="animate-spin" /><span className="sr-only">Bestelling laden…</span></div>;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input: AdminOrderActionInput = {
      action,
      expectedVersion: order.version,
      externalReference: externalReference.trim() || undefined,
      trackingUrl: trackingUrl.trim() || undefined,
      notes: notes.trim() || undefined,
      idempotencyKey: crypto.randomUUID(),
    };
    try {
      await mutation.mutateAsync(input);
      toast.success(ACTION_LABELS[action]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "De bestelling kon niet worden bijgewerkt.");
    }
  };

  const address = order.shippingAddress;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Button asChild variant="ghost"><Link to="/beheer/bestellingen"><ArrowLeft /> Terug naar bestellingen</Link></Button>
      <div className="mt-6 border-b border-border pb-7 md:flex md:items-start md:justify-between md:gap-8">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{order.orderNumber}</p>
          <h1 className="mt-2 text-3xl font-semibold">{order.projectTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{order.customerName} · betaald {dateTime(order.paidAt)}</p>
        </div>
        <div className={`mt-4 inline-flex min-h-11 items-center border px-4 text-sm font-semibold md:mt-0 ${order.needsAttention ? "border-amber-400 bg-amber-50 text-amber-900" : "border-border bg-muted/30"}`}>
          {order.needsAttention ? <AlertTriangle className="mr-2 h-4 w-4" /> : <PackageCheck className="mr-2 h-4 w-4" />}
          {STATUS_LABELS[order.fulfilmentStatus]}
        </div>
      </div>

      <div className="grid gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        <div className="space-y-9">
          <section aria-labelledby="print-proof-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold" id="print-proof-title">Exacte printversie</h2>
              <Button asChild><a href={order.pdfPath}><Download /> Download print-PDF</a></Button>
            </div>
            <dl className="mt-5 grid gap-x-6 gap-y-4 border-y border-border py-5 text-sm sm:grid-cols-2">
              <Fact label="Revisie" value={order.proofRevisionId} mono />
              <Fact label="Boek" value={`${order.quantity} × ${order.pageCount} pagina’s`} />
              <Fact label="Document-hash" value={order.documentSha256} mono />
              <Fact label="PDF-hash" value={order.pdfSha256} mono />
            </dl>
          </section>

          <section aria-labelledby="delivery-address-title">
            <h2 className="text-xl font-semibold" id="delivery-address-title">Klant en bezorging</h2>
            <div className="mt-4 grid gap-6 text-sm sm:grid-cols-2">
              <div><p className="text-muted-foreground">Klant</p><p className="mt-1 font-medium">{order.customerName}</p><p>{order.customerEmail}</p></div>
              <address className="not-italic"><p className="text-muted-foreground">Bezorgadres</p><p className="mt-1 font-medium">{address.firstName} {address.lastName}</p><p>{address.addressLine1}</p>{address.addressLine2 ? <p>{address.addressLine2}</p> : null}<p>{address.postalCode} {address.city}</p><p>{address.countryCode}</p></address>
            </div>
          </section>

          <section aria-labelledby="order-history-title">
            <h2 className="text-xl font-semibold" id="order-history-title">Auditgeschiedenis</h2>
            <ol className="mt-4 border-l border-border pl-5">
              {order.events.map((item) => (
                <li className="relative pb-5 text-sm" key={item.id}>
                  <span className="absolute -left-[1.45rem] top-1 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                  <p className="font-medium">{item.eventType.replaceAll("_", " ")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dateTime(item.occurredAt)}{item.toStatus ? ` · ${item.fromStatus ?? "—"} → ${item.toStatus}` : ""}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside aria-labelledby="fulfilment-action-title">
          <form className="sticky top-24 border border-border bg-card p-5" onSubmit={submit}>
            <h2 className="text-xl font-semibold" id="fulfilment-action-title">Handmatige afhandeling bijwerken</h2>
            <div className="mt-5 space-y-5">
              <div><Label htmlFor="fulfilment-action">Actie</Label><Select value={action} onValueChange={(value) => setAction(value as ManualFulfilmentAction)}><SelectTrigger className="mt-2 min-h-11" id="fulfilment-action"><SelectValue /></SelectTrigger><SelectContent>{availableActions(order).map((item) => <SelectItem key={item} value={item}>{ACTION_LABELS[item]}</SelectItem>)}</SelectContent></Select></div>
              <div><Label htmlFor="external-reference">Externe drukkerreferentie</Label><Input className="mt-2 min-h-11" id="external-reference" maxLength={200} onChange={(event) => setExternalReference(event.target.value)} value={externalReference} /></div>
              <div><Label htmlFor="tracking-url">Trackinglink</Label><Input className="mt-2 min-h-11" id="tracking-url" inputMode="url" onChange={(event) => setTrackingUrl(event.target.value)} placeholder="https://…" value={trackingUrl} /></div>
              <div><Label htmlFor="fulfilment-notes">Interne notitie</Label><Textarea className="mt-2 min-h-28" id="fulfilment-notes" maxLength={4000} onChange={(event) => setNotes(event.target.value)} value={notes} /><p className="mt-1 text-xs text-muted-foreground">Alleen zichtbaar voor bevoegde beheerders.</p></div>
              {action === "ordered_manually" && !externalReference.trim() ? <p className="text-sm text-amber-800" role="alert">Vul de externe referentie in voordat je de handmatige bestelling vastlegt.</p> : null}
              <Button className="min-h-11 w-full" disabled={mutation.isPending || (action === "ordered_manually" && !externalReference.trim())} type="submit">
                {mutation.isPending ? <Loader2 className="animate-spin" /> : action === "mark_shipped" ? <Truck /> : <PackageCheck />}
                {ACTION_LABELS[action]}
              </Button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
};

const Fact = ({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) => (
  <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className={`mt-1 break-all font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</dd></div>
);

const OrderAdmin = () => {
  const { orderId } = useParams<{ orderId?: string }>();
  const { user, loading } = useAuth();
  usePageMeta({ title: orderId ? "Bestelling beheren — Buildy" : "Betaalde Bouwboeken — Buildy", noIndex: true });

  if (loading) return <main className="flex min-h-[60vh] items-center justify-center" role="status"><Loader2 className="animate-spin" /><span className="sr-only">Beheeromgeving laden…</span></main>;
  if (!user) return <Navigate to={`/auth?next=${encodeURIComponent(orderId ? `/beheer/bestellingen/${orderId}` : "/beheer/bestellingen")}`} replace />;
  return <main>{orderId ? <OrderDetail orderId={orderId} /> : <OrderList />}</main>;
};

export default OrderAdmin;
