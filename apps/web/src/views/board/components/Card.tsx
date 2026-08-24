import { t } from "@lingui/core/macro";
import { format, isSameYear } from "date-fns";
import { HiOutlinePaperClip } from "react-icons/hi";
import {
  HiBars3BottomLeft,
  HiChatBubbleLeft,
  HiCheck,
  HiOutlineClock,
  HiOutlinePencilSquare,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardPriority } from "~/utils/card-presentation";
import Avatar from "~/components/Avatar";
import Badge from "~/components/Badge";
import CardProgressBars from "~/components/CardProgressBars";
import LabelIcon from "~/components/LabelIcon";
import { PriorityIndicator } from "~/components/PrioritySelector";
import { useLocalisation } from "~/hooks/useLocalisation";
import { getAvatarUrl } from "~/utils/helpers";
import { DevelopmentProgress } from "~/views/card/components/DevelopmentProgress";

const Card = ({
  title,
  ticketNumber,
  labels,
  members,
  checklists,
  description,
  comments,
  resourceSummary,
  dueDate,
  startedAt,
  completedAt,
  priority = "none",
  colourCode,
  subtaskSummary,
  hasCanvas = false,
  isSelectionMode = false,
  isSelected = false,
}: {
  title: string;
  ticketNumber?: string | null;
  labels: { name: string; colourCode: string | null }[];
  members: {
    publicId: string;
    email: string;
    user: { name: string | null; email: string; image: string | null } | null;
  }[];
  checklists: {
    publicId: string;
    name: string;
    items: {
      publicId: string;
      title: string;
      completed: boolean;
      index: number;
    }[];
  }[];
  description: string | null;
  comments: { publicId: string }[];
  resourceSummary?: {
    total: number;
    uploads: number;
    driveLinks: number;
    webLinks: number;
  };
  dueDate?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  priority?: CardPriority;
  colourCode?: string | null;
  subtaskSummary?: {
    total: number;
    completed: number;
    blocked: number;
    progressPercent: number;
  };
  hasCanvas?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
}) => {
  const { dateLocale } = useLocalisation();
  const showYear = dueDate ? !isSameYear(dueDate, new Date()) : false;
  const isOverdue = dueDate
    ? completedAt
      ? completedAt.getTime() > dueDate.getTime()
      : Date.now() >= dueDate.getTime()
    : false;

  const hasDescription =
    description && description.replace(/<[^>]*>/g, "").trim().length > 0;
  const hasResources = (resourceSummary?.total ?? 0) > 0;
  const hasDueDate = !!dueDate;

  return (
    <div
      className={twMerge(
        "relative flex flex-col overflow-hidden rounded-md border bg-light-50 px-3 py-2 text-sm text-neutral-900 transition-[border-color,box-shadow,background-color] duration-300 dark:bg-dark-200 dark:text-dark-1000",
        isSelectionMode
          ? "border-light-500 pr-10 hover:bg-light-100 dark:border-dark-500 dark:hover:bg-dark-300"
          : "border-light-200 dark:border-dark-200 dark:hover:bg-dark-300",
        isSelected &&
          "border-light-1000 shadow-[inset_0_0_0_1px] shadow-light-1000 dark:border-dark-1000 dark:shadow-dark-1000",
      )}
      style={
        colourCode
          ? { borderLeftColor: colourCode, borderLeftWidth: "4px" }
          : undefined
      }
    >
      {isSelectionMode && (
        <span
          className={twMerge(
            "absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded border transition-colors duration-300",
            isSelected
              ? "border-light-1000 bg-light-1000 text-light-50 dark:border-dark-1000 dark:bg-dark-1000 dark:text-dark-50"
              : "border-light-600 bg-light-50 text-transparent dark:border-dark-600 dark:bg-dark-200",
          )}
          aria-hidden="true"
        >
          <HiCheck className="h-3.5 w-3.5" />
        </span>
      )}
      {ticketNumber && (
        <span className="mb-1 text-xs text-light-700 dark:text-dark-800">
          {ticketNumber}
        </span>
      )}
      <span className="break-words">{title}</span>
      {priority !== "none" && (
        <div className="mt-1.5">
          <PriorityIndicator priority={priority} />
        </div>
      )}
      {labels.length ||
      members.length ||
      checklists.length > 0 ||
      hasDescription ||
      comments.length > 0 ||
      hasDueDate ||
      hasResources ||
      hasCanvas ||
      (subtaskSummary?.total ?? 0) > 0 ? (
        <div className="mt-2 flex flex-col justify-end">
          <div className="space-x-0.5">
            {labels.map((label) => (
              <Badge
                key={`${label.name}-${label.colourCode ?? "none"}`}
                value={label.name}
                iconLeft={<LabelIcon colourCode={label.colourCode} />}
              />
            ))}
          </div>
          <div className="mt-2">
            <CardProgressBars
              checklists={checklists}
              startedAt={startedAt}
              dueDate={dueDate}
              completedAt={completedAt}
              compact
            />
            {subtaskSummary && (
              <DevelopmentProgress summary={subtaskSummary} compact />
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-1">
            <div className="flex items-center gap-2">
              {hasDescription && (
                <div className="flex items-center gap-1 text-light-700 dark:text-dark-800">
                  <HiBars3BottomLeft className="h-4 w-4" />
                </div>
              )}
              {dueDate && (
                <div
                  className={twMerge(
                    "flex items-center gap-1",
                    isOverdue
                      ? "text-red-600 dark:text-red-400"
                      : "text-light-800 dark:text-dark-800",
                  )}
                >
                  <HiOutlineClock className="h-4 w-4" />
                  <span className="text-[11px]">
                    {format(
                      dueDate,
                      showYear ? "do MMM yyyy · HH:mm" : "do MMM · HH:mm",
                      { locale: dateLocale },
                    )}
                  </span>
                </div>
              )}
              {comments.length > 0 && (
                <div className="flex items-center gap-1 text-light-700 dark:text-dark-800">
                  <HiChatBubbleLeft className="h-4 w-4" />
                </div>
              )}
              {hasResources && (
                <div className="flex items-center gap-1 text-light-700 dark:text-dark-800">
                  <span className="sr-only">
                    {t`${resourceSummary?.total ?? 0} resources`}
                  </span>
                  <HiOutlinePaperClip className="h-4 w-4" aria-hidden="true" />
                  <span className="text-[11px] tabular-nums" aria-hidden="true">
                    {resourceSummary?.total}
                  </span>
                </div>
              )}
              {hasCanvas && (
                <div className="flex items-center gap-1 text-light-700 dark:text-dark-800">
                  <span className="sr-only">{t`Has whiteboard`}</span>
                  <HiOutlinePencilSquare
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-1">
              {members.length > 0 && (
                <div className="isolate flex justify-end -space-x-1 overflow-hidden">
                  {members.map(({ user, email }) => {
                    const avatarUrl = user?.image
                      ? getAvatarUrl(user.image)
                      : undefined;

                    return (
                      <Avatar
                        key={`${email}-${user?.email ?? "guest"}`}
                        name={user?.name ?? ""}
                        email={user?.email ?? email}
                        imageUrl={avatarUrl}
                        size="sm"
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Card;
