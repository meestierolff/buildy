import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Loader2 } from "lucide-react";

import NotificationList from "@/components/notifications/NotificationList";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import {
  useInfiniteNotifications,
  useMarkAllNotificationsReadMutation,
} from "@/hooks/useEngagement";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link } from "@/lib/router";

const NotificationBell = () => {
  const { user } = useAuth();
  const notificationsQuery = useInfiniteNotifications(Boolean(user));
  const markAllReadMutation = useMarkAllNotificationsReadMutation();
  const [open, setOpen] = useState(false);
  const markedOpen = useRef(false);

  const notifications = useMemo(
    () => notificationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [notificationsQuery.data],
  );
  const unreadCount = notificationsQuery.data?.pages.at(-1)?.unreadCount ?? 0;

  useEffect(() => {
    if (!open || unreadCount === 0 || markedOpen.current) return;
    markedOpen.current = true;
    void markAllReadMutation.mutateAsync().catch((error: unknown) => {
      console.error("Notifications could not be marked as read", error);
    });
  }, [markAllReadMutation, open, unreadCount]);

  if (!user) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) markedOpen.current = false;
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unreadCount ? `Meldingen, ${unreadCount} ongelezen` : "Meldingen"}
          className="relative h-9 w-9 rounded-full text-foreground hover:bg-muted"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-sm font-semibold">Meldingen</span>
          <Link
            to={PRODUCT_ROUTES.notifications}
            onClick={() => setOpen(false)}
            className="rounded-sm text-xs font-semibold text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Alles bekijken
          </Link>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notificationsQuery.isPending ? (
            <p className="flex items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Meldingen laden…
            </p>
          ) : notificationsQuery.isError ? (
            <div className="space-y-3 p-6 text-center" role="alert">
              <p className="text-sm text-muted-foreground">Meldingen konden niet worden geladen.</p>
              <Button size="sm" variant="outline" onClick={() => void notificationsQuery.refetch()}>
                Opnieuw proberen
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nog geen meldingen</p>
          ) : (
            <>
              <NotificationList
                notifications={notifications}
                compact
                onNavigate={() => setOpen(false)}
              />
              {notificationsQuery.hasNextPage ? (
                <div className="border-t p-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full"
                    disabled={notificationsQuery.isFetchingNextPage}
                    onClick={() => void notificationsQuery.fetchNextPage()}
                  >
                    {notificationsQuery.isFetchingNextPage ? "Meer laden…" : "Meer meldingen laden"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
