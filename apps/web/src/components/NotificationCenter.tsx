import { Menu, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { formatDistanceToNow, isToday } from "date-fns";
import { Fragment } from "react";
import {
  HiAtSymbol,
  HiCheck,
  HiExclamationTriangle,
  HiOutlineBell,
  HiOutlineClock,
  HiOutlineUserGroup,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { RouterOutputs } from "~/utils/api";
import { useLocalisation } from "~/hooks/useLocalisation";
import { useNotifications } from "~/providers/notifications";

type NotificationItem = RouterOutputs["notification"]["list"]["items"][number];

const notificationPresentation = (notification: NotificationItem) => {
  switch (notification.type) {
    case "card.priority.urgent":
      return {
        title: t`Urgent priority`,
        description: t`This task was marked as urgent.`,
        icon: HiExclamationTriangle,
        iconClassName: "text-red-600 dark:text-red-400",
      };
    case "card.due.soon":
      return {
        title: t`Due in less than 24 hours`,
        description: t`This task is approaching its due time.`,
        icon: HiOutlineClock,
        iconClassName: "text-amber-600 dark:text-amber-400",
      };
    case "card.due.overdue":
      return {
        title: t`Task overdue`,
        description: t`The due time has passed.`,
        icon: HiExclamationTriangle,
        iconClassName: "text-red-600 dark:text-red-400",
      };
    case "mention":
      return {
        title: t`New mention`,
        description: t`You were mentioned in a card comment.`,
        icon: HiAtSymbol,
        iconClassName: "text-blue-600 dark:text-blue-400",
      };
    case "workspace.member.added":
      return {
        title: t`Workspace access`,
        description: t`You were added to a workspace.`,
        icon: HiOutlineUserGroup,
        iconClassName: "text-emerald-600 dark:text-emerald-400",
      };
    case "workspace.member.removed":
      return {
        title: t`Workspace access changed`,
        description: t`You were removed from a workspace.`,
        icon: HiOutlineUserGroup,
        iconClassName: "text-light-800 dark:text-dark-800",
      };
    case "workspace.role.changed":
      return {
        title: t`Workspace role changed`,
        description: t`Your workspace permissions were updated.`,
        icon: HiOutlineUserGroup,
        iconClassName: "text-blue-600 dark:text-blue-400",
      };
  }
};

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: NotificationItem;
  onOpen: (notification: NotificationItem) => Promise<void>;
}) {
  const { dateLocale } = useLocalisation();
  const presentation = notificationPresentation(notification);
  const Icon = presentation.icon;

  return (
    <Menu.Item>
      <button
        type="button"
        onClick={() => void onOpen(notification)}
        className={twMerge(
          "group relative flex w-full gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-700",
          !notification.readAt && "bg-light-100 dark:bg-dark-200",
        )}
      >
        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-light-300 bg-light-50 dark:border-dark-400 dark:bg-dark-100">
          <Icon className={twMerge("h-4 w-4", presentation.iconClassName)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-light-1000 dark:text-dark-1000">
              {presentation.title}
            </span>
            {!notification.readAt && (
              <span
                className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-600"
                aria-label={t`Unread`}
              />
            )}
          </span>
          {notification.card && (
            <span className="mt-0.5 block truncate text-xs text-light-950 dark:text-dark-950">
              {notification.card.title}
            </span>
          )}
          <span className="mt-0.5 block text-[11px] leading-4 text-light-800 dark:text-dark-800">
            {presentation.description}
            {notification.card?.boardName
              ? ` · ${notification.card.boardName}`
              : ""}
          </span>
          <span className="mt-1 block text-[10px] text-light-700 dark:text-dark-700">
            {formatDistanceToNow(new Date(notification.createdAt), {
              addSuffix: true,
              locale: dateLocale,
            })}
          </span>
        </span>
      </button>
    </Menu.Item>
  );
}

function NotificationGroup({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: NotificationItem[];
  onOpen: (notification: NotificationItem) => Promise<void>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="px-1 pb-1">
      <p className="px-3 pb-1 pt-2 text-[10px] font-medium tracking-wide text-light-700 dark:text-dark-700">
        {title}
      </p>
      {items.map((notification) => (
        <NotificationRow
          key={notification.publicId}
          notification={notification}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

export function NotificationCenter({
  placement,
  isCollapsed = false,
}: {
  placement: "mobile" | "sidebar";
  isCollapsed?: boolean;
}) {
  const {
    items,
    unreadCount,
    isLoading,
    isError,
    isLoadingMore,
    hasMore,
    openNotification,
    markAllRead,
    loadMore,
  } = useNotifications();

  const today = items.filter((item) => isToday(new Date(item.createdAt)));
  const earlier = items.filter((item) => !isToday(new Date(item.createdAt)));

  return (
    <Menu as="div" className="relative w-full text-left">
      <Menu.Button
        className={twMerge(
          "relative flex items-center rounded-md text-neutral-900 transition-colors hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-700",
          placement === "mobile"
            ? "h-8 w-8 justify-center"
            : "w-full gap-2 p-1.5",
          placement === "sidebar" && isCollapsed && "md:justify-center",
        )}
        aria-label={
          unreadCount > 0
            ? t`${unreadCount} unread notifications`
            : t`Notifications`
        }
        title={isCollapsed ? t`Notifications` : undefined}
      >
        <span className="relative flex h-6 w-6 items-center justify-center">
          <HiOutlineBell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-light-100 dark:ring-dark-100">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </span>
        {placement === "sidebar" && (
          <span
            className={twMerge("truncate text-sm", isCollapsed && "md:hidden")}
          >
            {t`Notifications`}
          </span>
        )}
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-150"
        enterFrom="translate-y-1 opacity-0"
        enterTo="translate-y-0 opacity-100"
        leave="transition ease-in duration-100"
        leaveFrom="translate-y-0 opacity-100"
        leaveTo="translate-y-1 opacity-0"
      >
        <Menu.Items
          className={twMerge(
            "z-[110] overflow-hidden rounded-lg border border-light-300 bg-light-50 shadow-xl focus:outline-none dark:border-dark-400 dark:bg-dark-100",
            placement === "mobile"
              ? "fixed left-3 right-3 top-14 max-h-[calc(100dvh-4.5rem)]"
              : "absolute bottom-11 left-0 max-h-[min(38rem,calc(100dvh-5rem))] w-80",
          )}
        >
          <div className="flex items-center justify-between border-b border-light-300 px-4 py-3 dark:border-dark-400">
            <div>
              <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
                {t`Notifications`}
              </h2>
              <p className="text-[11px] text-light-700 dark:text-dark-700">
                {unreadCount > 0
                  ? t`${unreadCount} unread`
                  : t`You're all caught up`}
              </p>
            </div>
            {unreadCount > 0 && (
              <Menu.Item as={Fragment}>
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-900 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-700"
                >
                  <HiCheck className="h-4 w-4" />
                  {t`Mark all read`}
                </button>
              </Menu.Item>
            )}
          </div>

          <div className="max-h-[min(30rem,calc(100dvh-10rem))] overflow-y-auto p-1">
            {isLoading ? (
              <div
                className="space-y-2 p-3"
                aria-label={t`Loading notifications`}
              >
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-16 animate-pulse rounded-md bg-light-200 dark:bg-dark-300"
                  />
                ))}
              </div>
            ) : isError ? (
              <div className="px-5 py-10 text-center">
                <HiExclamationTriangle className="mx-auto h-6 w-6 text-red-500" />
                <p className="mt-2 text-xs font-medium text-light-950 dark:text-dark-950">
                  {t`Notifications could not be loaded`}
                </p>
                <p className="mt-1 text-[11px] text-light-700 dark:text-dark-700">
                  {t`Close this panel and try again.`}
                </p>
              </div>
            ) : items.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <HiOutlineBell className="mx-auto h-6 w-6 text-light-700 dark:text-dark-700" />
                <p className="mt-2 text-xs font-medium text-light-950 dark:text-dark-950">
                  {t`No notifications yet`}
                </p>
                <p className="mt-1 text-[11px] text-light-700 dark:text-dark-700">
                  {t`Task alerts and mentions will appear here.`}
                </p>
              </div>
            ) : (
              <>
                <NotificationGroup
                  title={t`Today`}
                  items={today}
                  onOpen={openNotification}
                />
                <NotificationGroup
                  title={t`Earlier`}
                  items={earlier}
                  onOpen={openNotification}
                />
                {hasMore && (
                  <div className="border-t border-light-300 p-2 dark:border-dark-400">
                    <Menu.Item as={Fragment}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          void loadMore();
                        }}
                        disabled={isLoadingMore}
                        className="w-full rounded-md px-3 py-2 text-xs font-medium text-light-900 hover:bg-light-200 disabled:opacity-60 dark:text-dark-900 dark:hover:bg-dark-300"
                      >
                        {isLoadingMore ? t`Loading…` : t`Load more`}
                      </button>
                    </Menu.Item>
                  </div>
                )}
              </>
            )}
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
