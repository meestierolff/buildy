import { Bell, CheckCheck, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import AsyncState from "@/components/app/AsyncState";
import NotificationList from "@/components/notifications/NotificationList";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useInfiniteNotifications, useNotificationMutation } from "@/hooks/useEngagement";
import { usePageMeta } from "@/hooks/usePageMeta";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Navigate } from "@/lib/router";

const Notifications = () => {
  const { user, loading: authLoading } = useAuth();
  const notificationsQuery = useInfiniteNotifications(Boolean(user));
  const readMutation = useNotificationMutation();
  const [markingAll, setMarkingAll] = useState(false);
  const notifications = useMemo(
    () => notificationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [notificationsQuery.data],
  );
  const unreadIds = notifications
    .filter((notification) => notification.status === "unread")
    .map((notification) => notification.id);

  usePageMeta({
    title: "Notificaties — Buildy",
    description: "Bekijk en beheer meldingen over je projecten en connecties.",
    path: PRODUCT_ROUTES.notifications,
    noIndex: true,
  });

  const markAllVisibleRead = async () => {
    if (markingAll || unreadIds.length === 0) return;
    setMarkingAll(true);
    try {
      const results = await Promise.allSettled(unreadIds.map((notificationId) =>
        readMutation.mutateAsync({ action: "read", notificationId })));
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) {
        console.error("Some visible notifications could not be marked as read");
        toast.error("Niet alle meldingen konden als gelezen worden gemarkeerd");
      } else {
        toast.success("Zichtbare meldingen gemarkeerd als gelezen");
      }
    } finally {
      setMarkingAll(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Account controleren…</span>
      </div>
    );
  }

  if (!user) return <Navigate to={authPagePath(PRODUCT_ROUTES.notifications)} replace />;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 md:py-16">
      <header className="mb-8 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Jouw activiteit</p>
          <h1 className="font-serif text-4xl leading-tight md:text-5xl">Notificaties</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Verzoeken, reacties en projectupdates die voor jouw account bestemd zijn.
          </p>
        </div>
        {unreadIds.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0 gap-2"
            disabled={markingAll}
            onClick={() => void markAllVisibleRead()}
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            {markingAll ? "Bezig…" : "Zichtbare gelezen"}
          </Button>
        ) : null}
      </header>

      {notificationsQuery.isPending ? (
        <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Meldingen laden…
        </p>
      ) : notificationsQuery.isError ? (
        <AsyncState
          status="error"
          title="Notificaties zijn even niet bereikbaar"
          description="We tonen geen eerder geladen accountmeldingen wanneer de controle mislukt. Probeer het opnieuw."
          action={(
            <Button variant="outline" className="gap-2" onClick={() => void notificationsQuery.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen
            </Button>
          )}
        />
      ) : notifications.length === 0 ? (
        <AsyncState
          status="empty"
          icon={<Bell className="h-6 w-6" aria-hidden="true" />}
          title="Je bent helemaal bij"
          description="Nieuwe verzoeken, reacties en andere relevante activiteit verschijnen hier."
        />
      ) : (
        <>
          <NotificationList notifications={notifications} />
          {notificationsQuery.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={notificationsQuery.isFetchingNextPage}
                onClick={() => void notificationsQuery.fetchNextPage()}
              >
                {notificationsQuery.isFetchingNextPage ? "Meldingen laden…" : "Meer meldingen laden"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
};

export default Notifications;
