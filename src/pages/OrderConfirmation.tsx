import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  CreditCard,
  Mail,
  Package,
  Printer,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

interface OrderRow {
  id: string;
  trip_id: string;
  merchant_reference: string;
  peecho_id: string | null;
  format: string;
  page_count: number;
  status: string;
  payment_status: string | null;
  payment_amount_cents: number | null;
  payment_currency: string | null;
  fulfillment_status: string | null;
  fulfillment_error: string | null;
  tracking_code: string | null;
  tracking_url: string | null;
  customer_email: string | null;
  paid_at: string | null;
  created_at: string;
  ordered_at: string | null;
  status_updated_at: string | null;
}

interface EventRow {
  id: string;
  event_type: string;
  payload: any;
  created_at: string;
}

const ORDER_SELECT =
  "id, trip_id, merchant_reference, peecho_id, format, page_count, status, payment_status, payment_amount_cents, payment_currency, fulfillment_status, fulfillment_error, tracking_code, tracking_url, customer_email, paid_at, created_at, ordered_at, status_updated_at";

const formatMoney = (cents: number | null | undefined, currency: string | null | undefined) => {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: (currency || "EUR").toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `€ ${(cents / 100).toFixed(2)}`;
  }
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const EVENT_LABELS: Record<string, string> = {
  stripe_checkout_created: "Beveiligde betaling gestart",
  stripe_payment_completed: "Betaling ontvangen",
  peecho_order_submit_attempt: "Order doorgestuurd naar drukker",
  peecho_order_submitted: "Drukker heeft order geaccepteerd",
  peecho_pingback: "Statusupdate van drukker",
};

const STATUS_PIPELINE: { key: string; label: string; icon: any }[] = [
  { key: "payment", label: "Betaling", icon: CreditCard },
  { key: "submitted", label: "Drukker", icon: Printer },
  { key: "fulfillment", label: "Productie", icon: Package },
  { key: "shipped", label: "Verzending", icon: Truck },
];

const pipelineState = (order: OrderRow) => {
  const paid = order.payment_status === "paid";
  const submitted =
    !!order.peecho_id ||
    ["submitted_to_peecho", "in_production", "shipped", "delivered"].includes(order.status);
  const inProduction = ["in_production", "shipped", "delivered"].includes(order.status);
  const shipped =
    !!order.tracking_url || !!order.tracking_code || ["shipped", "delivered"].includes(order.status);
  return { payment: paid, submitted, fulfillment: inProduction, shipped };
};

const OrderConfirmation = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const justPaid = searchParams.get("checkout") === "success";

  usePageMeta({
    title: order ? `Bestelling ${order.merchant_reference} — Buildy` : "Je bestelling — Buildy",
    description: "Bekijk de status van je Buildy Bouwboek bestelling.",
    noIndex: true,
  });

  useEffect(() => {
    if (!orderId || authLoading) return;
    if (!user) {
      setLoading(false);
      setError("Log in om je bestelling te bekijken.");
      return;
    }

    let cancelled = false;
    let pollTimer: number | null = null;

    const load = async () => {
      const { data, error: orderErr } = await supabase
        .from("photobook_orders")
        .select(ORDER_SELECT)
        .eq("id", orderId)
        .maybeSingle();

      if (cancelled) return;
      if (orderErr || !data) {
        setError("We konden deze bestelling niet vinden.");
        setLoading(false);
        return;
      }
      setOrder(data as unknown as OrderRow);

      const { data: evs } = await supabase
        .from("photobook_order_events")
        .select("id, event_type, payload, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled) setEvents((evs || []) as EventRow[]);
      setLoading(false);
    };

    load();

    // Poll while we expect status to change (right after checkout)
    if (justPaid) {
      pollTimer = window.setInterval(() => {
        load();
      }, 4000) as unknown as number;
      // Stop polling after 90s regardless
      window.setTimeout(() => {
        if (pollTimer) window.clearInterval(pollTimer);
      }, 90_000);
    }

    // Realtime updates on this row
    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "photobook_orders", filter: `id=eq.${orderId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "photobook_order_events", filter: `order_id=eq.${orderId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [orderId, user, authLoading, justPaid]);

  useEffect(() => {
    if (justPaid && order?.payment_status === "paid") {
      toast.success("Betaling ontvangen — je bestelling is bevestigd.");
    }
  }, [justPaid, order?.payment_status]);

  const state = useMemo(() => (order ? pipelineState(order) : null), [order]);

  if (loading) {
    return (
      <div className="container max-w-3xl py-10 space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="container max-w-2xl py-16 text-center space-y-4">
        <XCircle className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-serif">{error || "Bestelling niet gevonden"}</h1>
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeft className="mr-2 h-4 w-4" /> Terug naar Buildy
          </Link>
        </Button>
      </div>
    );
  }

  const isPaid = order.payment_status === "paid";
  const isFailed = ["failed", "cancelled", "refunded"].includes(order.payment_status || "");

  return (
    <div className="container max-w-3xl py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/trip/${order.trip_id}/photobook`}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Terug naar Bouwboek
          </Link>
        </Button>
        <Badge variant={isPaid ? "default" : isFailed ? "destructive" : "secondary"}>
          {isPaid ? "Betaald" : isFailed ? "Betaling mislukt" : "In afwachting"}
        </Badge>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-start gap-3">
            {isPaid ? (
              <CheckCircle2 className="h-8 w-8 text-primary mt-0.5" />
            ) : isFailed ? (
              <XCircle className="h-8 w-8 text-destructive mt-0.5" />
            ) : (
              <Clock className="h-8 w-8 text-muted-foreground mt-0.5" />
            )}
            <div className="flex-1">
              <CardTitle className="font-serif text-2xl">
                {isPaid
                  ? "Bedankt voor je bestelling"
                  : isFailed
                    ? "Betaling niet voltooid"
                    : "Betaling wordt verwerkt"}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Referentie:{" "}
                <span className="font-mono text-foreground">{order.merchant_reference}</span>
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Formaat</div>
              <div className="font-medium">{order.format.replace(/_/g, " ")}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Pagina's</div>
              <div className="font-medium">{order.page_count}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Bedrag</div>
              <div className="font-medium">
                {formatMoney(order.payment_amount_cents, order.payment_currency)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Besteld op</div>
              <div className="font-medium">{formatDate(order.created_at)}</div>
            </div>
          </div>

          {order.customer_email && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-md p-3">
              <Mail className="h-4 w-4" />
              <span>
                Bevestiging en updates worden gestuurd naar{" "}
                <span className="text-foreground font-medium">{order.customer_email}</span>
              </span>
            </div>
          )}

          {isPaid && !order.tracking_url && (
            <p className="text-sm text-muted-foreground">
              Je boek wordt nu gedrukt en in een hardcover gebonden. Verwachte levering: 5–10
              werkdagen na productie.
            </p>
          )}

          {order.tracking_url && (
            <Button asChild>
              <a href={order.tracking_url} target="_blank" rel="noreferrer">
                <Truck className="mr-2 h-4 w-4" /> Track je pakket
                {order.tracking_code ? ` (${order.tracking_code})` : ""}
              </a>
            </Button>
          )}

          {isFailed && (
            <Button asChild variant="outline">
              <Link to={`/trip/${order.trip_id}/photobook`}>Probeer opnieuw te bestellen</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Status</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex items-center justify-between gap-2">
            {STATUS_PIPELINE.map((step, idx) => {
              const Icon = step.icon;
              const done = state?.[step.key as keyof typeof state];
              return (
                <li key={step.key} className="flex-1 flex flex-col items-center text-center">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center border-2 ${
                      done
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-muted"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs mt-2 font-medium">{step.label}</span>
                  {idx < STATUS_PIPELINE.length - 1 && (
                    <div className="hidden md:block w-full h-px bg-border mt-5 -mb-5" />
                  )}
                </li>
              );
            })}
          </ol>

          {order.fulfillment_error && (
            <div className="mt-4 text-sm text-destructive border border-destructive/30 rounded-md p-3">
              {order.fulfillment_error}
            </div>
          )}
        </CardContent>
      </Card>

      {events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tijdlijn</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id} className="flex items-start gap-3 text-sm">
                  <div className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium">
                      {EVENT_LABELS[ev.event_type] || ev.event_type}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {formatDate(ev.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="text-center text-sm text-muted-foreground space-y-2">
        <p>
          Vragen over je bestelling? Mail ons op{" "}
          <a href="mailto:support@buildy.app" className="underline">
            support@buildy.app
          </a>{" "}
          met referentie <span className="font-mono">{order.merchant_reference}</span>.
        </p>
        <p>
          <Link to="/account" className="underline">
            Bekijk al je bestellingen in je account
          </Link>
        </p>
      </div>
    </div>
  );
};

export default OrderConfirmation;
