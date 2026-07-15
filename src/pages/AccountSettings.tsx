import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { BookOpen, ChevronRight, Loader2, KeyRound, Trash2, Mail } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";

interface OrderSummary {
  id: string;
  status: string;
  created_at: string;
  format: string | null;
  payment_amount_cents: number | null;
  payment_currency: string | null;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Checkout voorbereid",
  payment_pending: "Betaling in behandeling",
  paid: "Betaald",
  submitted: "Naar de drukker",
  processing: "In productie",
  shipped: "Verzonden",
  delivered: "Afgerond",
  cancelled: "Geannuleerd",
  refunded: "Terugbetaald",
  payment_cancelled: "Betaling geannuleerd",
  payment_expired: "Checkout verlopen",
  payment_failed: "Betaling mislukt",
  fulfillment_failed: "Handmatige opvolging nodig",
};

const formatOrderAmount = (amount: number | null, currency: string | null) => {
  if (amount == null || amount <= 0) return null;
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: (currency || "eur").toUpperCase(),
  }).format(amount / 100);
};

const AccountSettings = () => {
  usePageMeta({
    title: "Account & instellingen — Buildy",
    description: "Beheer je wachtwoord en account.",
    path: "/account",
    noIndex: true,
  });
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setOrders([]);
      setOrdersLoading(false);
      return () => { cancelled = true; };
    }

    setOrdersLoading(true);
    setOrdersError(false);
    supabase
      .from("photobook_orders")
      .select("id, status, created_at, format, payment_amount_cents, payment_currency")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Order history load failed", error);
          setOrdersError(true);
        } else {
          setOrders(data || []);
        }
        setOrdersLoading(false);
      });

    return () => { cancelled = true; };
  }, [user]);

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Account laden…</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth?next=/account" replace />;

  const handleResetMail = async () => {
    if (!user.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/wachtwoord-resetten`,
    });
    if (error) toast.error("Kon geen reset-mail sturen.");
    else toast.success("Reset-link verstuurd naar je e-mail.");
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Wachtwoord moet minstens 6 tekens zijn.");
      return;
    }
    setSavingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPwd(false);
    if (error) {
      toast.error("Wachtwoord wijzigen mislukt.");
      return;
    }
    setNewPassword("");
    toast.success("Wachtwoord bijgewerkt.");
  };

  const handleDelete = async () => {
    setDeleting(true);
    const { error, response } = await supabase.functions.invoke("delete-account");
    if (error) {
      console.error(error);
      let message = "Account verwijderen mislukt. Probeer het later opnieuw.";
      if (response) {
        try {
          const payload = await response.json() as { error?: unknown };
          if (typeof payload.error === "string" && payload.error.trim()) {
            message = payload.error;
          }
        } catch (parseError) {
          console.error("Could not read account deletion error", parseError);
        }
      }
      toast.error(message);
      setDeleting(false);
      return;
    }
    toast.success("Je account is verwijderd.");
    await signOut();
    navigate("/");
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-12 space-y-10">
      <div>
        <p className="eyebrow mb-2">Account</p>
        <h1 className="font-serif italic text-4xl leading-tight">Instellingen</h1>
        <p className="text-sm text-muted-foreground mt-3">Beheer je login en account.</p>
      </div>

      <section className="border border-border rounded-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Mail className="h-4 w-4 mt-1 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">E-mail</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </section>

      <section className="border border-border rounded-md p-6 space-y-5">
        <div className="flex items-start gap-3">
          <KeyRound className="h-4 w-4 mt-1 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Wachtwoord</h2>
            <p className="text-sm text-muted-foreground">Wijzig direct of vraag een reset-link aan via e-mail.</p>
          </div>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <Input
            type="password"
            aria-label="Nieuw wachtwoord"
            placeholder="Nieuw wachtwoord"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={6}
            className="h-10"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={savingPwd || !newPassword} size="sm" className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest">
              {savingPwd ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Wachtwoord opslaan"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleResetMail} className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest">
              Stuur reset-link
            </Button>
          </div>
        </form>
      </section>

      <section className="border border-border rounded-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <BookOpen className="h-4 w-4 mt-1 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Mijn Bouwboeken</h2>
            <p className="text-sm text-muted-foreground">
              Bekijk de betaling, productie en verzending van je bestellingen.
            </p>
          </div>
        </div>

        {ordersLoading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Bestellingen laden…
          </div>
        ) : ordersError ? (
          <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
            Je bestellingen konden niet worden geladen. Vernieuw de pagina om het opnieuw te proberen.
          </p>
        ) : orders.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            Je hebt nog geen Bouwboek besteld.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {orders.map((order) => {
              const amount = formatOrderAmount(order.payment_amount_cents, order.payment_currency);
              return (
                <Link
                  key={order.id}
                  to={`/bestelling/${order.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-md last:rounded-b-md hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {order.format?.replace(/_/g, " ") || "Bouwboek"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(new Date(order.created_at))}
                      {amount ? ` · ${amount}` : ""}
                    </p>
                  </div>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {ORDER_STATUS_LABELS[order.status] || "Status bekijken"}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="border border-destructive/30 rounded-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Trash2 className="h-4 w-4 mt-1 text-destructive" />
          <div>
            <h2 className="text-sm font-semibold text-destructive">Account verwijderen</h2>
            <p className="text-sm text-muted-foreground">
              Dit verwijdert je profiel, projecten, updates en geüploade foto's permanent.
              Tijdens een open checkout of lopende Bouwboek-bestelling kan je account nog
              niet worden verwijderd. Na afronding bewaren we alleen de wettelijk vereiste
              minimale bestel- en betaalgegevens.
            </p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest">
              Account permanent verwijderen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Weet je het zeker?</AlertDialogTitle>
              <AlertDialogDescription>
                Deze actie is onomkeerbaar. Typ <strong>VERWIJDEREN</strong> hieronder om te bevestigen.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-label="Typ VERWIJDEREN om accountverwijdering te bevestigen"
              placeholder="VERWIJDEREN"
              className="h-10"
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Annuleren</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirm !== "VERWIJDEREN" || deleting}
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verwijder mijn account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  );
};

export default AccountSettings;
