import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { t } from "@lingui/core/macro";
import { useEffect, useRef } from "react";
import {
  HiLink,
  HiOutlineArrowRightCircle,
  HiOutlineCalendar,
  HiOutlineDocumentDuplicate,
  HiOutlineFlag,
  HiOutlinePaintBrush,
  HiOutlineTag,
  HiOutlineTrash,
  HiOutlineUserGroup,
  HiOutlineViewColumns,
} from "react-icons/hi2";

export type CardContextMenuAction =
  | "members"
  | "move"
  | "moveBoard"
  | "labels"
  | "priority"
  | "colour"
  | "dueDate"
  | "copyLink"
  | "duplicate"
  | "delete";

interface CardContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: CardContextMenuAction) => void;
  canEdit: boolean;
  canMoveToBoard: boolean;
  canSetDueDate: boolean;
}

const getMenuItems = (): {
  action: CardContextMenuAction;
  label: string;
  icon: React.ReactNode;
  requiresEdit: boolean;
}[] => [
  {
    action: "members",
    label: t`Manage members`,
    icon: <HiOutlineUserGroup className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "move",
    label: t`Move to another list`,
    icon: <HiOutlineArrowRightCircle className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "moveBoard",
    label: t`Move to another board`,
    icon: <HiOutlineViewColumns className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "labels",
    label: t`Add / edit label`,
    icon: <HiOutlineTag className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "priority",
    label: t`Set priority`,
    icon: <HiOutlineFlag className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "colour",
    label: t`Set card colour`,
    icon: <HiOutlinePaintBrush className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "dueDate",
    label: t`Set due date`,
    icon: <HiOutlineCalendar className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "copyLink",
    label: t`Copy link to card`,
    icon: <HiLink className="h-4 w-4 shrink-0" />,
    requiresEdit: false,
  },
  {
    action: "duplicate",
    label: t`Duplicate card`,
    icon: <HiOutlineDocumentDuplicate className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "delete",
    label: t`Delete card`,
    icon: <HiOutlineTrash className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
];

export function CardContextMenu({
  x,
  y,
  onClose,
  onAction,
  canEdit,
  canMoveToBoard,
  canSetDueDate,
}: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      e.preventDefault();
      e.stopPropagation();
      const returnFocus = returnFocusRef.current;
      onClose();
      window.requestAnimationFrame(() => returnFocus?.focus());
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role='menuitem']")
      ?.focus();
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const items = getMenuItems().filter(
    (item) =>
      (!item.requiresEdit || canEdit) &&
      (item.action !== "moveBoard" || canMoveToBoard) &&
      (item.action !== "dueDate" || canSetDueDate),
  );
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      onClose();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitem']",
      ) ?? [],
    );
    if (menuItems.length === 0) return;

    event.preventDefault();
    const currentIndex = menuItems.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? menuItems.length - 1
          : event.key === "ArrowDown"
            ? currentIndex < 0
              ? 0
              : (currentIndex + 1) % menuItems.length
            : currentIndex < 0
              ? menuItems.length - 1
              : (currentIndex - 1 + menuItems.length) % menuItems.length;
    menuItems[nextIndex]?.focus();
  };
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const menuWidth = Math.min(200, Math.max(0, viewportWidth - 16));
  const position =
    typeof window === "undefined"
      ? { left: x, top: y }
      : {
          left: Math.min(
            Math.max(x, 8),
            Math.max(8, viewportWidth - menuWidth - 8),
          ),
          ...(y > window.innerHeight / 2
            ? { bottom: Math.max(window.innerHeight - y, 8) }
            : { top: Math.max(y, 8) }),
        };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t`Card actions`}
      onKeyDown={handleMenuKeyDown}
      className="fixed z-[200] max-h-[calc(100vh-1rem)] w-[min(200px,calc(100vw-1rem))] overflow-y-auto rounded-md border border-light-200 bg-white py-1 shadow-lg dark:border-dark-400 dark:bg-dark-200"
      style={position}
    >
      {items.map(({ action, label, icon }) => (
        <button
          key={action}
          type="button"
          role="menuitem"
          onClick={() => {
            onAction(action);
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-900 hover:bg-light-200 dark:text-dark-1000 dark:hover:bg-dark-400"
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}
