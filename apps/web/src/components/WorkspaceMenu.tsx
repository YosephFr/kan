import { useRouter } from "next/navigation";
import { Button, Menu, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { env } from "next-runtime-env";
import { Fragment, useMemo, useState } from "react";
import {
  HiCheck,
  HiEllipsisHorizontal,
  HiMagnifyingGlass,
  HiPlus,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { useKeyboardShortcut } from "~/providers/keyboard-shortcuts";
import { useModal } from "~/providers/modal";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import CommandPallette from "./CommandPallette";
import { Tooltip } from "./Tooltip";
import { WorkspaceLogo } from "./WorkspaceLogo";

export default function WorkspaceMenu({
  isCollapsed = false,
}: {
  isCollapsed?: boolean;
}) {
  const { workspace, isLoading, availableWorkspaces, switchWorkspace } =
    useWorkspace();
  const { openModal } = useModal();
  const { data: hasPartnerSlot } =
    api.workspace.hasAvailablePartnerSlot.useQuery();
  const router = useRouter();
  const [isCommandOpen, setIsCommandOpen] = useState(false);

  const orderedWorkspaces = useMemo(() => {
    const active = availableWorkspaces.find(
      (item) => item.publicId === workspace.publicId,
    );
    const remaining = availableWorkspaces.filter(
      (item) => item.publicId !== workspace.publicId,
    );
    return active ? [active, ...remaining] : remaining;
  }, [availableWorkspaces, workspace.publicId]);

  const visibleWorkspaces = orderedWorkspaces.slice(0, 3);
  const additionalWorkspaces = orderedWorkspaces.slice(3);

  const { tooltipContent: commandPaletteShortcutTooltipContent } =
    useKeyboardShortcut({
      type: "PRESS",
      stroke: {
        key: "k",
        modifiers: ["META"],
      },
      action: () => setIsCommandOpen(true),
      description: t`Open command menu`,
      group: "GENERAL",
    });

  const openCreateWorkspace = () => {
    if (env("NEXT_PUBLIC_KAN_ENV") !== "cloud") {
      openModal("NEW_WORKSPACE");
    } else if (hasPartnerSlot) {
      router.push(
        `/onboarding/workspace?partner=1&returnUrl=${encodeURIComponent(window.location.pathname)}`,
      );
    } else {
      router.push(
        `/onboarding/select-plan?returnUrl=${encodeURIComponent(window.location.pathname)}`,
      );
    }
  };

  const workspaceButton = (
    availableWorkspace: (typeof availableWorkspaces)[number],
    compact = false,
  ) => {
    const isActive = workspace.publicId === availableWorkspace.publicId;

    return (
      <button
        key={availableWorkspace.publicId}
        type="button"
        onClick={() => switchWorkspace(availableWorkspace)}
        className={twMerge(
          "flex h-9 w-full min-w-0 items-center rounded-md px-2 text-left text-sm text-neutral-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-1000 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-700",
          isActive && "bg-light-200 dark:bg-dark-300",
          isCollapsed && !compact && "md:w-9 md:justify-center md:px-0",
        )}
        aria-current={isActive ? "page" : undefined}
        aria-label={availableWorkspace.name}
        title={isCollapsed && !compact ? availableWorkspace.name : undefined}
      >
        <WorkspaceLogo
          name={availableWorkspace.name}
          logo={availableWorkspace.logo}
          size="sm"
        />
        <span
          className={twMerge(
            "ml-2 min-w-0 flex-1 truncate font-semibold",
            isCollapsed && !compact && "md:hidden",
          )}
        >
          {availableWorkspace.name}
        </span>
        {availableWorkspace.plan === "pro" && (
          <span
            className={twMerge(
              "ml-2 text-[10px] font-medium text-light-900 dark:text-dark-900",
              isCollapsed && !compact && "md:hidden",
            )}
          >
            Pro
          </span>
        )}
        {compact && isActive && (
          <HiCheck className="ml-2 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        )}
      </button>
    );
  };

  return (
    <>
      <CommandPallette
        isOpen={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
      />
      <div className="pb-3">
        <div
          className={twMerge(
            "mb-1 flex h-8 items-center justify-between px-2",
            isCollapsed && "md:justify-center md:px-0",
          )}
        >
          <span
            className={twMerge(
              "text-xs font-semibold text-light-900 dark:text-dark-900",
              isCollapsed && "md:hidden",
            )}
          >
            {t`Workspaces`}
          </span>
          <Tooltip content={commandPaletteShortcutTooltipContent}>
            <Button
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-700"
              onClick={() => setIsCommandOpen(true)}
              aria-label={t`Search`}
            >
              <HiMagnifyingGlass className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>

        {isLoading ? (
          <div className="space-y-1">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className={twMerge(
                  "h-9 animate-pulse rounded-md bg-light-200 dark:bg-dark-200",
                  isCollapsed && "md:w-9",
                )}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleWorkspaces.map((item) => workspaceButton(item))}

            {additionalWorkspaces.length > 0 && (
              <Menu as="div" className="relative">
                <Menu.Button
                  className={twMerge(
                    "flex h-9 w-full items-center rounded-md px-2 text-sm font-medium text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-900 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-700",
                    isCollapsed && "md:w-9 md:justify-center md:px-0",
                  )}
                  title={isCollapsed ? t`Show more` : undefined}
                >
                  <HiEllipsisHorizontal
                    className="h-5 w-5 flex-shrink-0"
                    aria-hidden="true"
                  />
                  <span
                    className={twMerge(
                      "ml-2 truncate",
                      isCollapsed && "md:hidden",
                    )}
                  >
                    {t`Show more`}
                  </span>
                </Menu.Button>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items
                    className={twMerge(
                      "absolute left-0 z-20 mt-1 w-full origin-top-left rounded-md border border-light-600 bg-light-50 p-1 shadow-lg focus:outline-none dark:border-dark-600 dark:bg-dark-300",
                      isCollapsed &&
                        "md:left-full md:top-0 md:ml-2 md:mt-0 md:w-52",
                    )}
                  >
                    {additionalWorkspaces.map((item) => (
                      <Menu.Item key={item.publicId}>
                        {workspaceButton(item, true)}
                      </Menu.Item>
                    ))}
                  </Menu.Items>
                </Transition>
              </Menu>
            )}

            <button
              type="button"
              onClick={openCreateWorkspace}
              className={twMerge(
                "flex h-9 w-full items-center rounded-md px-2 text-sm font-medium text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-900 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-700",
                isCollapsed && "md:w-9 md:justify-center md:px-0",
              )}
              aria-label={t`Create workspace`}
              title={isCollapsed ? t`Create workspace` : undefined}
            >
              <HiPlus className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <span
                className={twMerge("ml-2 truncate", isCollapsed && "md:hidden")}
              >
                {t`Create workspace`}
              </span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
