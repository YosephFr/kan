import { t } from "@lingui/core/macro";
import { useEffect, useRef } from "react";
import {
  HiLink,
  HiOutlineArrowRightCircle,
  HiOutlineCalendar,
  HiOutlineDocumentDuplicate,
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
}: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const items = getMenuItems().filter(
    (item) =>
      (!item.requiresEdit || canEdit) &&
      (item.action !== "moveBoard" || canMoveToBoard),
  );
  const position =
    typeof window === "undefined"
      ? { left: x, top: y }
      : {
          ...(x > window.innerWidth / 2
            ? { right: Math.max(window.innerWidth - x, 8) }
            : { left: Math.max(x, 8) }),
          ...(y > window.innerHeight / 2
            ? { bottom: Math.max(window.innerHeight - y, 8) }
            : { top: Math.max(y, 8) }),
        };

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] max-h-[calc(100vh-1rem)] min-w-[200px] overflow-y-auto rounded-md border border-light-200 bg-white py-1 shadow-lg dark:border-dark-400 dark:bg-dark-200"
      style={position}
    >
      {items.map(({ action, label, icon }) => (
        <button
          key={action}
          type="button"
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
