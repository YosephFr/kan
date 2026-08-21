import { useRouter } from "next/navigation";
import { t } from "@lingui/core/macro";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { RouterOutputs } from "~/utils/api";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

type NotificationItem = RouterOutputs["notification"]["list"]["items"][number];

interface NotificationsContextValue {
  items: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  isError: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  openNotification: (notification: NotificationItem) => Promise<void>;
  markAllRead: () => Promise<void>;
  loadMore: () => Promise<void>;
}

const NotificationsContext = createContext<
  NotificationsContextValue | undefined
>(undefined);

const PAGE_SIZE = 20;
const SYNC_INTERVAL_MS = 60_000;

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { workspace, availableWorkspaces, switchWorkspace } = useWorkspace();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const previousUnreadCount = useRef<number | null>(null);
  const isSyncing = useRef(false);

  const listQuery = api.notification.list.useInfiniteQuery(
    { limit: PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const unreadQuery = api.notification.unreadCount.useQuery();
  const { mutateAsync: syncDueAlerts } =
    api.notification.syncDueAlerts.useMutation();
  const { mutateAsync: markRead } = api.notification.markRead.useMutation();
  const { mutateAsync: markAll } = api.notification.markAllRead.useMutation();

  const updateCachedReadState = useCallback(
    (notificationPublicId: string | null, readAt: Date) => {
      utils.notification.list.setInfiniteData({ limit: PAGE_SIZE }, (data) => {
        if (!data) return data;

        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              notificationPublicId === null ||
              item.publicId === notificationPublicId
                ? { ...item, readAt }
                : item,
            ),
          })),
        };
      });
    },
    [utils.notification.list],
  );

  useEffect(() => {
    if (!listQuery.data) return;
    setItems(listQuery.data.pages.flatMap((page) => page.items));
  }, [listQuery.data]);

  useEffect(() => {
    const count = unreadQuery.data?.count;
    if (count === undefined) return;

    if (
      previousUnreadCount.current !== null &&
      count > previousUnreadCount.current
    ) {
      showPopup({
        header: t`New alert`,
        message: t`You have a new task notification.`,
        icon: "info",
      });
    }

    previousUnreadCount.current = count;
  }, [showPopup, unreadQuery.data?.count]);

  const refreshNotifications = useCallback(async () => {
    if (document.visibilityState !== "visible" || isSyncing.current) return;

    isSyncing.current = true;
    try {
      await syncDueAlerts();
      await Promise.all([
        utils.notification.list.invalidate(),
        utils.notification.unreadCount.invalidate(),
      ]);
    } catch {
      return;
    } finally {
      isSyncing.current = false;
    }
  }, [syncDueAlerts, utils]);

  useEffect(() => {
    void refreshNotifications();

    const interval = window.setInterval(() => {
      void refreshNotifications();
    }, SYNC_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshNotifications();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [refreshNotifications]);

  const openNotification = useCallback(
    async (notification: NotificationItem) => {
      const destination = notification.card
        ? notification.subtask
          ? `/cards/${notification.card.publicId}?vista=subtareas&subtask=${notification.subtask.publicId}`
          : `/cards/${notification.card.publicId}`
        : null;
      const changesWorkspace =
        notification.card?.workspacePublicId !== undefined &&
        notification.card.workspacePublicId !== workspace.publicId;
      const targetWorkspace = changesWorkspace
        ? availableWorkspaces.find(
            (candidate) =>
              candidate.publicId === notification.card?.workspacePublicId,
          )
        : undefined;

      if (changesWorkspace && !targetWorkspace) {
        showPopup({
          header: t`Unable to open notification`,
          message: t`You no longer have access to this workspace.`,
          icon: "error",
        });
        return;
      }

      if (destination) {
        if (targetWorkspace) {
          switchWorkspace(targetWorkspace, destination);
        } else {
          router.push(destination);
        }
      }

      if (!notification.readAt) {
        const readAt = new Date();
        setItems((current) =>
          current.map((item) =>
            item.publicId === notification.publicId
              ? { ...item, readAt }
              : item,
          ),
        );
        updateCachedReadState(notification.publicId, readAt);

        try {
          await markRead({
            notificationPublicId: notification.publicId,
          });
          await utils.notification.unreadCount.invalidate();
        } catch {
          await Promise.all([
            utils.notification.list.invalidate(),
            utils.notification.unreadCount.invalidate(),
          ]);
          showPopup({
            header: t`Unable to update notifications`,
            message: t`Please try again later.`,
            icon: "error",
          });
        }
      }
    },
    [
      availableWorkspaces,
      markRead,
      router,
      showPopup,
      switchWorkspace,
      updateCachedReadState,
      utils,
      workspace.publicId,
    ],
  );

  const markAllRead = useCallback(async () => {
    try {
      await markAll();
      const readAt = new Date();
      setItems((current) => current.map((item) => ({ ...item, readAt })));
      updateCachedReadState(null, readAt);
      await utils.notification.unreadCount.invalidate();
    } catch {
      showPopup({
        header: t`Unable to update notifications`,
        message: t`Please try again later.`,
        icon: "error",
      });
    }
  }, [
    markAll,
    showPopup,
    updateCachedReadState,
    utils.notification.unreadCount,
  ]);

  const loadMore = useCallback(async () => {
    if (!listQuery.hasNextPage || listQuery.isFetchingNextPage) return;

    try {
      await listQuery.fetchNextPage();
    } catch {
      showPopup({
        header: t`Unable to load notifications`,
        message: t`Please try again later.`,
        icon: "error",
      });
    }
  }, [listQuery, showPopup]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      unreadCount: unreadQuery.data?.count ?? 0,
      isLoading: listQuery.isLoading || unreadQuery.isLoading,
      isError: listQuery.isError || unreadQuery.isError,
      isLoadingMore: listQuery.isFetchingNextPage,
      hasMore: listQuery.hasNextPage,
      openNotification,
      markAllRead,
      loadMore,
    }),
    [
      items,
      listQuery.isError,
      listQuery.isLoading,
      loadMore,
      markAllRead,
      listQuery.hasNextPage,
      listQuery.isFetchingNextPage,
      openNotification,
      unreadQuery.data?.count,
      unreadQuery.isError,
      unreadQuery.isLoading,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error(
      "useNotifications must be used within a NotificationsProvider",
    );
  }
  return context;
}
