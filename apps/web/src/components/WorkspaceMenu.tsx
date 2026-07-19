import type {
  DraggableProvidedDragHandleProps,
  DropResult,
} from "react-beautiful-dnd";
import { useRouter } from "next/navigation";
import { Button, Menu, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { env } from "next-runtime-env";
import { Fragment, useEffect, useState } from "react";
import { DragDropContext, Draggable } from "react-beautiful-dnd";
import {
  HiCheck,
  HiEllipsisHorizontal,
  HiMagnifyingGlass,
  HiMapPin,
  HiOutlineMapPin,
  HiPlus,
} from "react-icons/hi2";
import { RiDraggable } from "react-icons/ri";
import { twMerge } from "tailwind-merge";

import { useKeyboardShortcut } from "~/providers/keyboard-shortcuts";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import CommandPallette from "./CommandPallette";
import { StrictModeDroppable as Droppable } from "./StrictModeDroppable";
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
  const { showPopup } = usePopup();
  const { data: hasPartnerSlot } =
    api.workspace.hasAvailablePartnerSlot.useQuery();
  const router = useRouter();
  const utils = api.useUtils();
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [sidebarWorkspaces, setSidebarWorkspaces] =
    useState(availableWorkspaces);

  useEffect(() => {
    setSidebarWorkspaces(availableWorkspaces);
  }, [availableWorkspaces]);

  const updatePreferences = api.workspace.updateSidebarPreferences.useMutation({
    onSuccess: async () => {
      await utils.workspace.all.invalidate();
    },
    onError: () => {
      setSidebarWorkspaces(availableWorkspaces);
      showPopup({
        header: t`Unable to save workspace order`,
        message: t`Please try again.`,
        icon: "error",
      });
    },
  });

  const persistPreferences = (nextWorkspaces: typeof availableWorkspaces) => {
    setSidebarWorkspaces(nextWorkspaces);
    updatePreferences.mutate({
      preferences: nextWorkspaces.map((item, position) => ({
        workspacePublicId: item.publicId,
        position,
        pinned: item.sidebarPinned,
      })),
    });
  };

  const handleDragEnd = ({ source, destination }: DropResult) => {
    if (updatePreferences.isPending) return;
    if (!destination || source.index === destination.index) return;

    const nextWorkspaces = [...sidebarWorkspaces];
    const [movedWorkspace] = nextWorkspaces.splice(source.index, 1);
    if (!movedWorkspace) return;

    const destinationWorkspace = nextWorkspaces[destination.index];
    if (
      destinationWorkspace &&
      destinationWorkspace.sidebarPinned !== movedWorkspace.sidebarPinned
    ) {
      return;
    }

    nextWorkspaces.splice(destination.index, 0, movedWorkspace);
    persistPreferences(nextWorkspaces);
  };

  const togglePin = (workspacePublicId: string) => {
    if (updatePreferences.isPending) return;
    const selected = sidebarWorkspaces.find(
      (item) => item.publicId === workspacePublicId,
    );
    if (!selected) return;

    const pinnedCount = sidebarWorkspaces.filter(
      (item) => item.sidebarPinned,
    ).length;
    if (!selected.sidebarPinned && pinnedCount >= 3) {
      showPopup({
        header: t`Three workspaces are already pinned`,
        message: t`Unpin one before pinning another.`,
        icon: "info",
      });
      return;
    }

    const remaining = sidebarWorkspaces.filter(
      (item) => item.publicId !== workspacePublicId,
    );
    const updated = { ...selected, sidebarPinned: !selected.sidebarPinned };
    const insertAt = updated.sidebarPinned
      ? remaining.filter((item) => item.sidebarPinned).length
      : remaining.findIndex((item) => !item.sidebarPinned);
    remaining.splice(insertAt < 0 ? remaining.length : insertAt, 0, updated);
    persistPreferences(remaining);
  };

  const visibleWorkspaces = sidebarWorkspaces.slice(0, 3);
  const additionalWorkspaces = sidebarWorkspaces.slice(3);

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

  const workspaceRow = (
    availableWorkspace: (typeof availableWorkspaces)[number],
    dragHandleProps?: DraggableProvidedDragHandleProps | null,
    compact = false,
  ) => {
    const isActive = workspace.publicId === availableWorkspace.publicId;

    return (
      <div
        className={twMerge(
          "group flex h-9 min-w-0 items-center rounded-md text-neutral-900 hover:bg-light-200 dark:text-dark-1000 dark:hover:bg-dark-300",
          isActive && "bg-light-200 dark:bg-dark-300",
          isCollapsed && !compact && "md:w-9 md:justify-center",
        )}
      >
        {!compact && !isCollapsed && (
          <button
            type="button"
            className="ml-1 flex h-7 w-5 flex-shrink-0 cursor-grab items-center justify-center rounded text-light-700 hover:text-light-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 active:cursor-grabbing dark:text-dark-700 dark:hover:text-dark-1000 dark:focus-visible:ring-dark-700"
            aria-label={t`Drag workspace`}
            {...dragHandleProps}
          >
            <RiDraggable className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => switchWorkspace(availableWorkspace)}
          className={twMerge(
            "flex h-full min-w-0 flex-1 items-center px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-700 dark:focus-visible:ring-dark-700",
            !compact && !isCollapsed && "pl-1",
            isCollapsed && !compact && "md:justify-center md:px-0",
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
            <HiCheck
              className="ml-2 h-4 w-4 flex-shrink-0"
              aria-hidden="true"
            />
          )}
        </button>
        {(!isCollapsed || compact) && (
          <button
            type="button"
            onClick={() => togglePin(availableWorkspace.publicId)}
            className={twMerge(
              "mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-light-700 hover:bg-light-300 hover:text-light-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-dark-700 dark:hover:bg-dark-400 dark:hover:text-dark-1000 dark:focus-visible:ring-dark-700",
              availableWorkspace.sidebarPinned &&
                "text-light-1000 dark:text-dark-1000",
            )}
            disabled={updatePreferences.isPending}
            aria-label={
              availableWorkspace.sidebarPinned
                ? t`Unpin workspace`
                : t`Pin workspace`
            }
            title={
              availableWorkspace.sidebarPinned
                ? t`Unpin workspace`
                : t`Pin workspace`
            }
          >
            {availableWorkspace.sidebarPinned ? (
              <HiMapPin className="h-4 w-4" aria-hidden="true" />
            ) : (
              <HiOutlineMapPin className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
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
          <div className="flex items-center">
            <Tooltip content={t`Create workspace`}>
              <Button
                className={twMerge(
                  "flex h-8 w-8 items-center justify-center rounded-md hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-700",
                  isCollapsed && "md:hidden",
                )}
                onClick={openCreateWorkspace}
                aria-label={t`Create workspace`}
              >
                <HiPlus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Tooltip>
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
          <>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="workspace-sidebar">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-1"
                  >
                    {visibleWorkspaces.map((item, index) => (
                      <Draggable
                        key={item.publicId}
                        draggableId={item.publicId}
                        index={index}
                        isDragDisabled={
                          isCollapsed || updatePreferences.isPending
                        }
                      >
                        {(draggableProvided, snapshot) => (
                          <div
                            ref={draggableProvided.innerRef}
                            {...draggableProvided.draggableProps}
                            className={twMerge(
                              snapshot.isDragging && "rounded-md shadow-lg",
                            )}
                          >
                            {workspaceRow(
                              item,
                              draggableProvided.dragHandleProps,
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            {additionalWorkspaces.length > 0 && (
              <Menu as="div" className="relative mt-1">
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
                      <Menu.Item key={item.publicId} as="div">
                        {workspaceRow(item, undefined, true)}
                      </Menu.Item>
                    ))}
                  </Menu.Items>
                </Transition>
              </Menu>
            )}
          </>
        )}
      </div>
    </>
  );
}
