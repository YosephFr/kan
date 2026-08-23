import type { KeyboardEvent } from "react";
import type { IconType } from "react-icons";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import {
  HiOutlineClipboardDocumentList,
  HiOutlineDocumentText,
  HiOutlinePaperClip,
  HiOutlinePencilSquare,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardWorkspaceView } from "~/utils/card-workspace";
import {
  getCardWorkspaceQueryValue,
  getNextTabIndex,
} from "~/utils/card-workspace";

interface CardWorkspaceTabsProps {
  activeView: CardWorkspaceView;
  developmentCount?: number;
  resourceCount?: number;
  hasCanvas?: boolean;
  compact?: boolean;
}

interface TabDefinition {
  view: CardWorkspaceView;
  label: string;
  icon: IconType;
  count?: number;
  hasContent?: boolean;
}

export function CardWorkspaceTabs({
  activeView,
  developmentCount,
  resourceCount,
  hasCanvas,
  compact = false,
}: CardWorkspaceTabsProps) {
  const router = useRouter();
  const tabs: TabDefinition[] = [
    {
      view: "summary",
      label: t`Summary`,
      icon: HiOutlineDocumentText,
    },
    {
      view: "subtasks",
      label: t`Subtasks`,
      icon: HiOutlineClipboardDocumentList,
      count: developmentCount,
    },
    {
      view: "whiteboard",
      label: t`Whiteboard`,
      icon: HiOutlinePencilSquare,
      hasContent: hasCanvas,
    },
    {
      view: "files",
      label: t`Files`,
      icon: HiOutlinePaperClip,
      count: resourceCount,
    },
  ];

  const changeView = async (view: CardWorkspaceView) => {
    const nextQuery: Record<string, string | string[] | undefined> = {
      ...router.query,
      vista: getCardWorkspaceQueryValue(view),
    };
    delete nextQuery.view;
    if (view !== "subtasks") delete nextQuery.subtask;
    if (view !== "whiteboard") delete nextQuery.frame;
    if (view !== "files") delete nextQuery.recurso;
    await router.replace(
      { pathname: router.pathname, query: nextQuery },
      undefined,
      { shallow: true },
    );
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const nextIndex = getNextTabIndex(currentIndex, tabs.length, event.key);
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    const nextElement =
      event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[
        nextIndex
      ];
    if (nextElement instanceof HTMLElement) nextElement.focus();
    if (nextTab) void changeView(nextTab.view);
  };

  return (
    <div
      role="tablist"
      aria-label={t`Card workspace views`}
      className={twMerge(
        "grid min-w-0 grid-cols-4 items-center gap-1",
        compact ? "w-full sm:flex" : "xl:flex",
      )}
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const isActive = activeView === tab.view;

        return (
          <button
            key={tab.view}
            id={`card-tab-${tab.view}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`card-view-${tab.view}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => void changeView(tab.view)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={twMerge(
              "relative inline-flex h-9 min-w-0 items-center justify-center gap-1 rounded-md px-1 text-[10px] font-medium text-light-800 transition-colors hover:bg-light-200 hover:text-light-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:hover:text-dark-1000 dark:focus-visible:ring-dark-800",
              compact
                ? "sm:shrink-0 sm:justify-start sm:gap-1.5 sm:px-2.5 sm:text-xs"
                : "xl:shrink-0 xl:justify-start xl:gap-1.5 xl:px-2.5 xl:text-xs",
              isActive &&
                "bg-light-200 text-light-1000 dark:bg-dark-200 dark:text-dark-1000",
            )}
          >
            <Icon
              className={twMerge(
                "h-3.5 w-3.5 shrink-0",
                compact ? "sm:h-4 sm:w-4" : "xl:h-4 xl:w-4",
              )}
              aria-hidden="true"
            />
            <span className="truncate">{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className="min-w-4 text-center text-[10px] tabular-nums text-light-700 dark:text-dark-700">
                {tab.count}
              </span>
            )}
            {tab.hasContent && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400"
                aria-label={t`Has content`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
