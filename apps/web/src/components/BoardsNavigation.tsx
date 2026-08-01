import Link from "next/link";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import {
  HiChevronDown,
  HiOutlineRectangleStack,
  HiOutlineViewColumns,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { KeyboardShortcut } from "~/providers/keyboard-shortcuts";
import LottieIcon from "~/components/LottieIcon";
import { useKeyboardShortcut } from "~/providers/keyboard-shortcuts";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { BOARDS_PATH, buildBoardPath, isBoardsPath } from "~/utils/navigation";

interface BoardsNavigationProps {
  icon: object;
  isCollapsed: boolean;
  keyboardShortcut: KeyboardShortcut;
  onCloseSideNav?: () => void;
  onExpandSidebar: () => void;
}

export default function BoardsNavigation({
  icon,
  isCollapsed,
  keyboardShortcut,
  onCloseSideNav,
  onExpandSidebar,
}: BoardsNavigationProps) {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const currentPath = router.asPath.split("?")[0] ?? "";
  const [isExpanded, setIsExpanded] = useState(isBoardsPath(currentPath));
  const [isHovered, setIsHovered] = useState(false);
  const [animationIndex, setAnimationIndex] = useState(0);
  const { keys: shortcutKeys } = useKeyboardShortcut(keyboardShortcut);
  const workspaceReady = workspace.publicId.length >= 12;
  const {
    data: boards,
    isLoading,
    error,
  } = api.board.all.useQuery(
    {
      workspacePublicId: workspace.publicId,
      type: "regular",
      archived: false,
    },
    { enabled: workspaceReady },
  );

  useEffect(() => {
    if (isBoardsPath(currentPath)) {
      setIsExpanded(true);
    }
  }, [currentPath]);

  const toggleBoards = () => {
    if (isCollapsed) {
      onExpandSidebar();
      setIsExpanded(true);
      return;
    }

    setIsExpanded((expanded) => !expanded);
  };

  const closeMobileNavigation = () => {
    onCloseSideNav?.();
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggleBoards}
        onMouseEnter={() => {
          setIsHovered(true);
          setAnimationIndex((index) => index + 1);
        }}
        onMouseLeave={() => setIsHovered(false)}
        aria-expanded={isExpanded && !isCollapsed}
        aria-controls="workspace-boards-navigation"
        className={twMerge(
          "group flex h-[34px] w-full items-center rounded-md p-1.5 text-sm font-normal leading-6 hover:bg-light-200 hover:text-light-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:hover:bg-dark-200 dark:hover:text-dark-1000 dark:focus-visible:ring-dark-700",
          isCollapsed ? "md:justify-center" : "justify-between",
          isBoardsPath(currentPath)
            ? "bg-light-200 text-light-1000 dark:bg-dark-200 dark:text-dark-1000"
            : "text-neutral-600 dark:bg-dark-100 dark:text-dark-900",
        )}
        title={isCollapsed ? t`Boards` : undefined}
      >
        <span
          className={twMerge(
            "flex items-center",
            isCollapsed
              ? "justify-start gap-x-3 md:justify-center md:gap-x-0"
              : "gap-x-3",
          )}
        >
          <LottieIcon
            index={animationIndex}
            json={icon}
            isPlaying={isHovered}
          />
          <span className={twMerge(isCollapsed && "md:hidden")}>
            {t`Boards`}
          </span>
        </span>
        <span
          className={twMerge(
            "ml-2 flex items-center gap-2",
            isCollapsed && "md:hidden",
          )}
        >
          <span className="hidden md:group-hover:inline-flex">
            {shortcutKeys}
          </span>
          <HiChevronDown
            className={twMerge(
              "h-4 w-4 transition-transform duration-300",
              isExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </span>
      </button>

      <div
        id="workspace-boards-navigation"
        className={twMerge(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          isExpanded && !isCollapsed
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <ul className="mb-1 ml-4 mt-1 space-y-0.5 border-l border-light-400 pl-2 dark:border-dark-400">
            <li>
              <Link
                href={BOARDS_PATH}
                onClick={closeMobileNavigation}
                aria-current={currentPath === BOARDS_PATH ? "page" : undefined}
                className={twMerge(
                  "flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm text-light-900 hover:bg-light-200 hover:text-light-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-900 dark:hover:bg-dark-200 dark:hover:text-dark-1000 dark:focus-visible:ring-dark-700",
                  currentPath === BOARDS_PATH &&
                    "bg-light-200 font-medium text-light-1000 dark:bg-dark-200 dark:text-dark-1000",
                )}
              >
                <HiOutlineRectangleStack
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">{t`All boards`}</span>
              </Link>
            </li>

            {isLoading &&
              [0, 1].map((item) => (
                <li
                  key={item}
                  className="h-8 animate-pulse rounded-md bg-light-200 dark:bg-dark-200"
                />
              ))}

            {!isLoading && error && (
              <li className="px-2 py-1.5 text-xs text-light-700 dark:text-dark-700">
                {t`Boards could not be loaded`}
              </li>
            )}

            {!isLoading && !error && boards?.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-light-700 dark:text-dark-700">
                {t`No active boards`}
              </li>
            )}

            {boards?.map((board) => {
              const href = buildBoardPath(board.publicId);
              const current = currentPath === href;

              return (
                <li key={board.publicId}>
                  <Link
                    href={href}
                    onClick={closeMobileNavigation}
                    aria-current={current ? "page" : undefined}
                    title={board.name}
                    className={twMerge(
                      "flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm text-light-900 hover:bg-light-200 hover:text-light-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-900 dark:hover:bg-dark-200 dark:hover:text-dark-1000 dark:focus-visible:ring-dark-700",
                      current &&
                        "bg-light-200 font-medium text-light-1000 dark:bg-dark-200 dark:text-dark-1000",
                    )}
                  >
                    <HiOutlineViewColumns
                      className="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{board.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
