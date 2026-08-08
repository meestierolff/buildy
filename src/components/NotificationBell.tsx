import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Loader2 } from "lucide-react";

import NotificationList from "@/components/notifications/NotificationList";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useInfiniteNotifications, useNotificationMutation } from "@/hooks/useEngagement";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link } from "@/lib/router";

const NotificationBell = () => {
  const { user } = useAuth();
  const notificationsQuery = useInfiniteNotifications(Boolean(user));
  const readMutation = useNotificationMutation();
  const [open, setOpen] = useState(false);
  const markingRead = useRef(false);
  const readAttempts = useRef(new Set<string>());

  const notifications = useMemo(
    () => notificationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [notificationsQuery.data],
  );
  const unread = notifications.filter((notification) => notification.status === "unread").length;

  const markVisibleRead = useCallback(async () => {
    if (markingRead.current) return;
    const unreadIds = notifications
      .filter((notification) => (
        notification.status === "unread" && !readAttempts.current.has(notification.id)
      ))
      .map((notification) => notification.id);
    if (unreadIds.length === 0) return;

    markingRead.current = true;
    unreadIds.forEach((notificationId) => readAttempts.current.add(notificationId));
    const results = await Promise.allSettled(unreadIds.map((notificationId) =>
      readMutation.mutateAsync({ action: "read", notificationId })));
    if (results.some((result) => result.status === "rejected")) {
      console.error("Some notifications could not be marked as read");
    }
    markingRead.current = false;
  }, [notifications, readMutation]);

  useEffect(() => {
    if (open) void markVisibleRead();
  }, [markVisibleRead, open]);

  if (!user) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) readAttempts.current.clear();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread ? `Meldingen, ${unread} ongelezen` : "Meldingen"}
          className="relative h-9 w-9 rounded-full text-foreground hover:bg-muted"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
              {unread > 9 ? "9+" : unread}
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
