import { useMemo } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Loader2,
  PackageCheck,
  RefreshCw,
  ReceiptText,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { CustomerOrderListItem } from "../../shared/contracts/orders";
import AsyncState from "@/components/app/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCustomerOrders } from "@/hooks/useOrders";
import { usePageMeta } from "@/hooks/usePageMeta";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, Navigate } from "@/lib/router";

type OrderStage = {
  icon: LucideIcon;
  label: string;
  tone: "attention" | "complete" | "neutral" | "problem";
};

function orderStage(order: CustomerOrderListItem): OrderStage {
  if (order.paymentStatus === "failed" || ["payment_failed", "expired", "cancelled"].includes(order.status)) {
    return { icon: XCircle, label: "Niet voltooid", tone: "problem" };
  }
  if (["partially_refunded", "refunded"].includes(order.paymentStatus)) {
    return { icon: ReceiptText, label: order.paymentStatus === "refunded" ? "Terugbetaald" : "Deels terugbetaald", tone: "attention" };
  }
  if (order.fulfilmentStatus === "completed") {
    return { icon: CheckCircle2, label: "Afgerond", tone: "complete" };
  }
  if (order.fulfilmentStatus === "shipped") {
    return { icon: Truck, label: "Verzonden", tone: "complete" };
  }
  if (["ordered_manually", "in_production"].includes(order.fulfilmentStatus)) {
    return { icon: PackageCheck, label: order.fulfilmentStatus === "in_production" ? "In productie" : "Besteld bij drukker", tone: "neutral" };
  }
  if (order.status === "manual_review" || ["manual_review", "refund_review"].includes(order.fulfilmentStatus)) {
    return { icon: Clock3, label: "Handmatige controle", tone: "attention" };
  }
  if (["paid", "partially_refunded", "refunded"].includes(order.paymentStatus)) {
    return { icon: CheckCircle2, label: "Betaling bevestigd", tone: "complete" };
  }
  return { icon: Clock3, label: order.paymentStatus === "processing" ? "Betaling wordt bevestigd" : "Wacht op betaling", tone: "neutral" };
}

function money(minor: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(minor / 100);
}

function orderDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" }).format(new Date(value));
}

const TONE_CLASSES: Record<OrderStage["tone"], string> = {
  attention: "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  complete: "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200",
  neutral: "border-border bg-muted/50 text-foreground",
  problem: "border-destructive/30 bg-destructive/10 text-destructive",
};

const Orders = () => {
  const { user, loading: authLoading } = useAuth();
  const ordersQuery = useCustomerOrders(Boolean(user));
  const orders = useMemo(
    () => ordersQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [ordersQuery.data],
  );

  usePageMeta({
    title: "Mijn bestellingen — Buildy",
    description: "Bekijk de vastgelegde status van je Bouwboekbestellingen.",
    path: PRODUCT_ROUTES.orders,
    noIndex: true,
  });

  if (authLoading) {
    return (
      <main className="flex min-h-[55vh] items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Bestellingen laden…</span>
      </main>
    );
  }

  if (!user) return <Navigate to={authPagePath(PRODUCT_ROUTES.orders)} replace />;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 md:py-16">
      <header className="mb-10 border-b border-border pb-8">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Jouw Bouwboeken</p>
        <h1 className="font-serif text-4xl leading-tight md:text-5xl">Bestellingen</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Van betaalbevestiging tot bezorging: iedere stap hieronder komt uit de afgeschermde bestelstatus van Buildy.
        </p>
      </header>

      {ordersQuery.isPending ? (
        <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Bestellingen laden…
        </p>
      ) : ordersQuery.isError ? (
        <AsyncState
          status="error"
          title="Je bestellingen zijn even niet bereikbaar"
          description="We tonen geen oude bestelgegevens wanneer de accountcontrole mislukt. Probeer het opnieuw."
          action={(
            <Button variant="outline" className="gap-2" onClick={() => void ordersQuery.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen
            </Button>
          )}
        />
      ) : orders.length === 0 ? (
        <AsyncState
          status="empty"
          icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
          title="Nog geen Bouwboek besteld"
          description="Maak vanuit een verbouwing eerst je Bouwboek en keur de echte printproof goed."
          action={(
            <Button asChild variant="outline">
              <Link to={PRODUCT_ROUTES.projects}>Naar mijn verbouwingen</Link>
            </Button>
          )}
        />
      ) : (
        <>
          <ol className="relative space-y-4 before:absolute before:bottom-8 before:left-5 before:top-8 before:w-px before:bg-border sm:before:left-7" aria-label="Bouwboekbestellingen">
            {orders.map((order) => {
              const stage = orderStage(order);
              const StageIcon = stage.icon;
              return (
                <li className="relative pl-12 sm:pl-16" key={order.orderId}>
                  <span className={`absolute left-0 top-6 z-10 flex h-10 w-10 items-center justify-center rounded-full border bg-background sm:left-2 ${TONE_CLASSES[stage.tone]}`} aria-hidden="true">
                    <StageIcon className="h-4 w-4" />
                  </span>
                  <Link
                    to={PRODUCT_ROUTES.order(order.orderId)}
                    className="group block rounded-xl border border-border bg-card p-5 shadow-xs transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none sm:p-6"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={TONE_CLASSES[stage.tone]}>{stage.label}</Badge>
                          <span className="font-mono text-[11px] text-muted-foreground">{order.orderNumber}</span>
                        </div>
                        <h2 className="mt-3 truncate font-serif text-2xl">{order.projectTitle}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          A4 liggend hardcover · {order.pageCount} pagina’s · {order.quantity} {order.quantity === 1 ? "exemplaar" : "exemplaren"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-end justify-between gap-4 sm:flex-col sm:text-right">
                        <div>
                          <p className="font-semibold tabular-nums">{money(order.amounts.totalMinor)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{orderDate(order.createdAt)}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
                          Bekijk voortgang <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>

          {ordersQuery.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={ordersQuery.isFetchingNextPage}
                onClick={() => void ordersQuery.fetchNextPage()}
              >
                {ordersQuery.isFetchingNextPage ? "Bestellingen laden…" : "Meer bestellingen laden"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
};

export default Orders;
