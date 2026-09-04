import type { DraggableProvided } from "react-beautiful-dnd";
import { t } from "@lingui/core/macro";
import { format, isSameYear } from "date-fns";
import {
  HiOutlineCalendarDays,
  HiOutlineCheckCircle,
  HiOutlineListBullet,
  HiOutlinePencilSquare,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardSubtask } from "./subtask-types";
import Avatar from "~/components/Avatar";
import { PriorityIndicator } from "~/components/PrioritySelector";
import { useLocalisation } from "~/hooks/useLocalisation";
import { getAvatarUrl } from "~/utils/helpers";

interface SubtaskCardProps {
  subtask: CardSubtask;
  provided: DraggableProvided;
  isDragging: boolean;
  onOpen: () => void;
}

export function SubtaskCard({
  subtask,
  provided,
  isDragging,
  onOpen,
}: SubtaskCardProps) {
  const { dateLocale } = useLocalisation();
  const completedItems = subtask.checklistItems.filter(
    (item) => item.completed,
  ).length;
  const isOverdue =
    subtask.dueDate !== null &&
    subtask.completedAt === null &&
    subtask.dueDate.getTime() <= Date.now();
  const ownerName = subtask.owner?.name ?? null;

  return (
    <button
      type="button"
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onClick={onOpen}
      className={twMerge(
        "group w-full border-b border-light-300 bg-light-50 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-light-100 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:border-dark-400 dark:bg-dark-100 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800",
        isDragging && "border-transparent shadow-lg",
      )}
    >
      <p className="break-words text-sm font-medium leading-5 text-light-1000 dark:text-dark-1000">
        {subtask.title}
      </p>
      {subtask.priority !== "none" && (
        <div className="mt-2">
          <PriorityIndicator priority={subtask.priority} />
        </div>
      )}
      <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-light-700 dark:text-dark-700">
          {subtask.dueDate && (
            <span
              className={twMerge(
                "flex items-center gap-1 whitespace-nowrap",
                isOverdue && "text-red-600 dark:text-red-400",
              )}
            >
              <HiOutlineCalendarDays className="h-3.5 w-3.5" />
              {format(
                subtask.dueDate,
                isSameYear(subtask.dueDate, new Date())
                  ? "d MMM · HH:mm"
                  : "d MMM yyyy · HH:mm",
                { locale: dateLocale },
              )}
            </span>
          )}
          {subtask.checklistItems.length > 0 && (
            <span
              className="flex items-center gap-1 whitespace-nowrap"
              aria-label={t`${completedItems} of ${subtask.checklistItems.length} checklist items completed`}
            >
              {completedItems === subtask.checklistItems.length ? (
                <HiOutlineCheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <HiOutlineListBullet className="h-3.5 w-3.5" />
              )}
              {completedItems}/{subtask.checklistItems.length}
            </span>
          )}
          {subtask.canvasFrame && (
            <span
              className="flex items-center gap-1 whitespace-nowrap"
              title={t`Linked to an archived whiteboard zone`}
            >
              <HiOutlinePencilSquare className="h-3.5 w-3.5" />
              <span className="sr-only">
                {t`Linked to an archived whiteboard zone`}
              </span>
            </span>
          )}
        </div>
        {subtask.owner && ownerName && (
          <Avatar
            size="xs"
            name={subtask.owner.name ?? ""}
            email=""
            imageUrl={
              subtask.owner.image
                ? getAvatarUrl(subtask.owner.image)
                : undefined
            }
          />
        )}
      </div>
    </button>
  );
}
