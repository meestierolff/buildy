import { useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  ReceiptText,
  RefreshCcw,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { PhotobookOrderDetail } from "../../shared/contracts/orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { usePhotobookOrder } from "@/hooks/useOrders";
import { usePageMeta } from "@/hooks/usePageMeta";
import { safeTrackingUrl } from "@/lib/orderApi";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, Navigate, useParams, useSearchParams } from "@/lib/router";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FULFILMENT_LABELS: Record<PhotobookOrderDetail["fulfilmentStatus"], string> = {
  awaiting_review: "Wacht op controle door Buildy",
  reviewed: "Gecontroleerd door Buildy",
  ordered_manually: "Besteld bij de drukker",
  in_production: "In productie",
  shipped: "Verzonden",
  completed: "Afgerond",
  manual_review: "Handmatige controle",
  cancelled: "Productie geannuleerd",
  refund_review: "Terugbetaling wordt beoordeeld",
};

const ORDER_STATUS_LABELS: Record<PhotobookOrderDetail["status"], string> = {
  draft: "Concept",
  awaiting_payment: "Wacht op betaling",
  checkout_open: "Betaalpagina geopend",
  paid: "Betaald",
  payment_failed: "Betaling mislukt",
  expired: "Betaling verlopen",
  cancelled: "Geannuleerd",
  manual_review: "Handmatige controle",
};

function money(minor: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(minor / 100);
}

function dateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

function paymentLabel(status: PhotobookOrderDetail["paymentStatus"]): string {
  switch (status) {
    case "paid": return "Betaald";
    case "processing": return "Wordt bevestigd";
    case "partially_refunded": return "Deels terugbetaald";
    case "refunded": return "Terugbetaald";
    case "failed": return "Mislukt";
    default: return "Nog niet betaald";
  }
}

function orderState(order: PhotobookOrderDetail, returnedFromCheckout: boolean) {
  const paymentConfirmed = ["paid", "partially_refunded", "refunded"].includes(order.paymentStatus);
  const failed = order.paymentStatus === "failed"
    || ["payment_failed", "expired", "cancelled"].includes(order.status);
  const refunded = ["partially_refunded", "refunded"].includes(order.paymentStatus);
  const review = order.status === "manual_review"
    || order.fulfilmentStatus === "manual_review"
    || order.fulfilmentStatus === "refund_review";
  const confirming = returnedFromCheckout && !paymentConfirmed && !failed;

  if (paymentConfirmed && refunded) {
    return {
      badge: paymentLabel(order.paymentStatus),
      badgeVariant: "secondary" as const,
      headline: order.paymentStatus === "refunded" ? "Je betaling is terugbetaald" : "Je betaling is deels terugbetaald",
      description: "De server heeft de terugbetaling bevestigd. De productie- en bezorgstatus staat hieronder afzonderlijk.",
      icon: ReceiptText,
      iconClass: "text-amber-600",
      paymentConfirmed,
      confirming: false,
      failed,
      review,
    };
  }
  if (paymentConfirmed) {
    return {
      badge: "Betaald",
      badgeVariant: "default" as const,
      headline: "Betaling bevestigd",
      description: "De betaling is server-side bevestigd. Buildy controleert je Bouwboek nu handmatig voordat de drukopdracht wordt geplaatst.",
      icon: CheckCircle2,
      iconClass: "text-emerald-600",
      paymentConfirmed,
      confirming: false,
      failed,
      review,
    };
  }
  if (failed) {
    return {
      badge: ORDER_STATUS_LABELS[order.status],
      badgeVariant: "destructive" as const,
      headline: "Betaling niet voltooid",
      description: "Er is geen betaalbevestiging ontvangen. Je Bouwboek wordt niet op basis van deze terugkeer als betaald behandeld.",
      icon: XCircle,
      iconClass: "text-destructive",
      paymentConfirmed,
      confirming: false,
      failed,
      review,
    };
  }
  if (confirming) {
    return {
      badge: "Wordt bevestigd",
      badgeVariant: "secondary" as const,
      headline: "Betaling wordt bevestigd",
      description: "Je bent terug van Stripe. Buildy controleert nu de serverstatus; alleen de webhookbevestiging geldt als betaalbewijs.",
      icon: Clock3,
      iconClass: "text-amber-600",
      paymentConfirmed,
      confirming,
      failed,
      review,
    };
  }
  return {
    badge: paymentLabel(order.paymentStatus),
    badgeVariant: "secondary" as const,
    headline: "Betaling nog niet bevestigd",
    description: "De order bestaat, maar de server heeft nog geen geslaagde betaling vastgelegd.",
    icon: Clock3,
    iconClass: "text-muted-foreground",
    paymentConfirmed,
    confirming: false,
    failed,
    review,
  };
}

function historyLabel(eventType: string): string {
  const exact: Record<string, string> = {
    "order.checkout_reserved.v1": "Bestelling aangemaakt",
    "order.checkout_opened.v1": "Betaalpagina geopend",
    "order.payment_processing.v1": "Betaling wordt verwerkt",
    "order.payment_succeeded.v1": "Betaling bevestigd",
    "order.payment_succeeded_manual_review.v1": "Betaling bevestigd; controle nodig",
    "order.payment_failed.v1": "Betaling mislukt",
    "order.checkout_expired.v1": "Betaalperiode verlopen",
    "order.refund_recorded.v1": "Terugbetaling vastgelegd",
    "order.stripe_event_ignored.v1": "Betaalstatus gecontroleerd",
    "order.stripe_reconciliation_failed.v1": "Betaalstatus vraagt controle",
    "order.refund_reconciliation_failed.v1": "Terugbetaling vraagt controle",
    "order.refund_out_of_order.v1": "Terugbetaling vraagt controle",
    "manual_fulfilment.review.v1": "Door Buildy gecontroleerd",
    "manual_fulfilment.ordered_manually.v1": "Bij de drukker besteld",
    "manual_fulfilment.mark_in_production.v1": "Productie gestart",
    "manual_fulfilment.mark_shipped.v1": "Bouwboek verzonden",
    "manual_fulfilment.mark_completed.v1": "Bestelling afgerond",
    "manual_fulfilment.manual_review.v1": "Handmatige controle gestart",
    "manual_fulfilment.cancel.v1": "Productie geannuleerd",
    "manual_fulfilment.refund_review.v1": "Terugbetaling wordt beoordeeld",
    "manual_fulfilment.update_details.v1": "Leveringsgegevens bijgewerkt",
  };
  if (exact[eventType]) return exact[eventType];
  return "Bestelstatus bijgewerkt";
}

function statusLabel(status: string | null): string | null {
  if (!status) return null;
  const labels: Record<string, string> = {
    ...ORDER_STATUS_LABELS,
    ...FULFILMENT_LABELS,
    processing: "Wordt bevestigd",
    unpaid: "Nog niet betaald",
    partially_refunded: "Deels terugbetaald",
    refunded: "Terugbetaald",
    failed: "Mislukt",
  };
  return labels[status] ?? null;
}

const OrderConfirmation = () => {
  const { orderId = "" } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const validOrderId = UUID.test(orderId);
  const orderQuery = usePhotobookOrder(orderId, Boolean(user) && validOrderId);
  const returnedFromCheckout = searchParams.get("checkout") === "success";
  const paidToastShown = useRef(false);
  const order = orderQuery.data;

  usePageMeta({
    title: order ? `Bestelling ${order.orderNumber} — Buildy` : "Je Bouwboekbestelling — Buildy",
    description: "Bekijk de serverbevestigde betaal-, productie- en bezorgstatus van je Bouwboek.",
    noIndex: true,
  });

  useEffect(() => {
    if (!returnedFromCheckout || order?.paymentStatus !== "paid" || paidToastShown.current) return;
    paidToastShown.current = true;
    toast.success("Je betaling is door de server bevestigd.");
  }, [order?.paymentStatus, returnedFromCheckout]);

  const presentation = useMemo(
    () => order ? orderState(order, returnedFromCheckout) : null,
    [order, returnedFromCheckout],
  );

  if (authLoading) {
    return <OrderLoading />;
  }

  if (!user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(`/bestellingen/${orderId}`)}`} replace />;
  }

  if (!validOrderId || orderQuery.isError) {
    return (
      <main className="container max-w-2xl py-16 text-center">
        <XCircle className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-4 font-serif text-3xl">Bestelling niet beschikbaar</h1>
        <p className="mt-2 text-sm text-muted-foreground" role="alert">
          Deze bestelling bestaat niet, hoort niet bij jouw account of kan momenteel niet veilig worden geladen.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {validOrderId && (
            <Button onClick={() => orderQuery.refetch()} type="button" variant="outline">
              <RefreshCcw aria-hidden="true" /> Opnieuw proberen
            </Button>
          )}
          <Button asChild variant="ghost"><Link to="/">Terug naar Buildy</Link></Button>
        </div>
      </main>
    );
  }

  if (orderQuery.isPending || !order || !presentation) {
    return <OrderLoading />;
  }

  const StatusIcon = presentation.icon;
  const trackingUrl = safeTrackingUrl(order.trackingUrl);
  const paidAt = dateTime(order.paidAt);
  const createdAt = dateTime(order.createdAt);

  return (
    <main className="container max-w-4xl space-y-6 py-8 md:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link to={PRODUCT_ROUTES.orders}>
            <ArrowLeft aria-hidden="true" /> Terug naar bestellingen
          </Link>
        </Button>
        <Badge variant={presentation.badgeVariant}>{presentation.badge}</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <StatusIcon className={`mt-0.5 h-8 w-8 shrink-0 ${presentation.iconClass}`} aria-hidden="true" />
            <div className="min-w-0">
              <CardTitle className="font-serif text-2xl md:text-3xl">{presentation.headline}</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                {presentation.description}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {order.projectTitle} · order <span className="font-mono text-foreground">{order.orderNumber}</span>
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {presentation.confirming && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm" role="status">
              {orderQuery.isFetching
                ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                : <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              <p>De status wordt automatisch iedere vier seconden gecontroleerd. Sluit dit scherm gerust; je kunt deze order later opnieuw openen.</p>
            </div>
          )}

          {presentation.review && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>Deze bestelling heeft handmatige aandacht nodig. Er wordt geen nieuwe productieactie aangenomen totdat de serverstatus is bijgewerkt.</p>
            </div>
          )}

          <section aria-labelledby="order-details-title">
            <h2 className="font-semibold" id="order-details-title">Bestelgegevens</h2>
            <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Product" value="A4 liggend hardcover" />
              <Detail label="Pagina’s" value={String(order.pageCount)} />
              <Detail label="Aantal" value={String(order.quantity)} />
              <Detail label="Bestemming" value={order.destinationCountry} />
              <Detail label="Orderstatus" value={ORDER_STATUS_LABELS[order.status]} />
              <Detail label="Betaalstatus" value={paymentLabel(order.paymentStatus)} />
              <Detail label="Aangemaakt" value={createdAt ?? "—"} />
              <Detail label="Betaald" value={paidAt ?? "Nog niet bevestigd"} />
            </dl>
          </section>

          <section aria-labelledby="order-price-title" className="rounded-lg border bg-muted/20 p-4">
            <h2 className="flex items-center gap-2 font-semibold" id="order-price-title">
              <ReceiptText className="h-4 w-4" aria-hidden="true" /> Vastgelegde prijs
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Amount label="Bouwboek" value={order.amounts.subtotalMinor} />
              <Amount label="Verzending" value={order.amounts.shippingMinor} />
              <Amount label="BTW" value={order.amounts.taxMinor} />
              {order.refundedMinor > 0 && (
                <Amount label="Terugbetaald" value={-order.refundedMinor} />
              )}
              <div className="flex justify-between gap-4 border-t pt-3 text-base font-bold">
                <dt>Totaal</dt><dd>{money(order.amounts.totalMinor)}</dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section aria-labelledby="delivery-status-title" className="rounded-lg border p-4 text-sm">
              <h2 className="flex items-center gap-2 font-semibold" id="delivery-status-title">
                <Truck className="h-4 w-4" aria-hidden="true" /> Levering
              </h2>
              <p className="mt-2">{order.deliveryEstimate}</p>
              <p className="mt-1 text-xs text-muted-foreground">{FULFILMENT_LABELS[order.fulfilmentStatus]}</p>
              {trackingUrl && (
                <Button asChild className="mt-3" size="sm">
                  <a href={trackingUrl} rel="noreferrer" target="_blank">Pakket volgen</a>
                </Button>
              )}
            </section>
            <section aria-labelledby="terms-snapshot-title" className="rounded-lg border p-4 text-sm">
              <h2 className="font-semibold" id="terms-snapshot-title">Voorwaarden bij bestelling</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Versie {order.termsVersion}. Dit gepersonaliseerde Bouwboek is volgens jouw specificaties gemaakt; de maatwerkuitzondering op het herroepingsrecht is van toepassing.
              </p>
              <Link className="mt-2 inline-block text-xs underline underline-offset-2" to="/voorwaarden">Voorwaarden bekijken</Link>
            </section>
          </div>

          {presentation.failed && (
            <Button asChild variant="outline">
              <Link to={`/project/${order.projectId}/bouwboek`}>Terug naar de goedgekeurde proof</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Je kunt de actuele status van je bestelling hier volgen. Hulp nodig?{" "}
        <Link className="font-medium text-foreground underline underline-offset-4" to="/support">
          Neem contact op met Buildy
        </Link>.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5 text-accent" aria-hidden="true" /> Vastgelegde voortgang
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Dit bouwspoor bestaat uit de gebeurtenissen die de server werkelijk voor deze bestelling heeft bewaard.
          </p>
        </CardHeader>
        <CardContent>
          {order.statusHistory.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" role="status">
              Er is nog geen statusgebeurtenis vastgelegd.
            </p>
          ) : (
            <ol className="relative space-y-5 before:absolute before:bottom-3 before:left-[0.4375rem] before:top-3 before:w-px before:bg-border" aria-label="Vastgelegde bestelgeschiedenis">
              {order.statusHistory.map((event, index) => {
                const from = statusLabel(event.fromStatus);
                const to = statusLabel(event.toStatus);
                return (
                  <li className="relative pl-8" key={event.id}>
                    <span className={`absolute left-0 top-1.5 z-10 h-3.5 w-3.5 rounded-full border-2 border-background ${index === order.statusHistory.length - 1 ? "bg-accent" : "bg-muted-foreground/50"}`} aria-hidden="true" />
                    <p className="text-sm font-semibold">{historyLabel(event.eventType)}</p>
                    {to && to !== from ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {from ? `${from} → ` : ""}{to}
                      </p>
                    ) : null}
                    <time className="mt-1 block text-xs text-muted-foreground" dateTime={event.occurredAt}>
                      {dateTime(event.occurredAt) ?? "Tijdstip onbekend"}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-between gap-3 border-t pt-5 text-xs text-muted-foreground">
        <p>Proofrevisie <span className="font-mono">{order.proofRevisionId}</span></p>
        <Button disabled={orderQuery.isFetching} onClick={() => orderQuery.refetch()} size="sm" type="button" variant="ghost">
          {orderQuery.isFetching
            ? <Loader2 className="animate-spin" aria-hidden="true" />
            : <RefreshCcw aria-hidden="true" />}
          Status vernieuwen
        </Button>
      </div>
    </main>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>
);

const Amount = ({ label, value }: { label: string; value: number }) => (
  <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd>{money(value)}</dd></div>
);

const OrderLoading = () => (
  <main className="container max-w-4xl space-y-4 py-10" aria-busy="true" aria-label="Bestelling laden">
    <Skeleton className="h-9 w-48" />
    <Skeleton className="h-52 w-full" />
    <Skeleton className="h-40 w-full" />
  </main>
);

export default OrderConfirmation;
