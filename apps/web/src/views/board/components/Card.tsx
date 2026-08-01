import { format, isBefore, isSameYear, startOfDay } from "date-fns";
import { HiOutlinePaperClip } from "react-icons/hi";
import {
  HiBars3BottomLeft,
  HiChatBubbleLeft,
  HiCheck,
  HiOutlineClock,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import Avatar from "~/components/Avatar";
import Badge from "~/components/Badge";
import CircularProgress from "~/components/CircularProgress";
import LabelIcon from "~/components/LabelIcon";
import { useLocalisation } from "~/hooks/useLocalisation";
import { getAvatarUrl } from "~/utils/helpers";

const Card = ({
  title,
  ticketNumber,
  labels,
  members,
  checklists,
  description,
  comments,
  attachments,
  dueDate,
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
  attachments?: { publicId: string }[];
  dueDate?: Date | null;
  isSelectionMode?: boolean;
  isSelected?: boolean;
}) => {
  const { dateLocale } = useLocalisation();
  const showYear = dueDate ? !isSameYear(dueDate, new Date()) : false;
  const isOverdue = dueDate ? isBefore(dueDate, startOfDay(new Date())) : false;
  const completedItems = checklists.reduce((acc, checklist) => {
    return acc + checklist.items.filter((item) => item.completed).length;
  }, 0);

  const totalItems = checklists.reduce((acc, checklist) => {
    return acc + checklist.items.length;
  }, 0);

  const progress =
    totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const hasDescription =
    description && description.replace(/<[^>]*>/g, "").trim().length > 0;
  const hasAttachments = attachments && attachments.length > 0;
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
      {labels.length ||
      members.length ||
      checklists.length > 0 ||
      hasDescription ||
      comments.length > 0 ||
      hasDueDate ||
      hasAttachments ? (
        <div className="mt-2 flex flex-col justify-end">
          <div className="space-x-0.5">
            {labels.map((label) => (
              <Badge
                value={label.name}
                iconLeft={<LabelIcon colourCode={label.colourCode} />}
              />
            ))}
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
                    {format(dueDate, showYear ? "do MMM yyyy" : "do MMM", {
                      locale: dateLocale,
                    })}
                  </span>
                </div>
              )}
              {comments.length > 0 && (
                <div className="flex items-center gap-1 text-light-700 dark:text-dark-800">
                  <HiChatBubbleLeft className="h-4 w-4" />
                </div>
              )}
              {hasAttachments && (
                <div className="flex items-center gap-1 text-light-700 dark:text-dark-800">
                  <HiOutlinePaperClip className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-1">
              {checklists.length > 0 && (
                <div className="flex items-center gap-1 rounded-full border-[1px] border-light-300 px-2 py-1 dark:border-dark-600">
                  <CircularProgress
                    progress={progress || 2}
                    size="sm"
                    className="flex-shrink-0"
                  />
                  <span className="text-[10px] text-light-900 dark:text-dark-950">
                    {completedItems}/{totalItems}
                  </span>
                </div>
              )}
              {members.length > 0 && (
                <div className="isolate flex justify-end -space-x-1 overflow-hidden">
                  {members.map(({ user, email }) => {
                    const avatarUrl = user?.image
                      ? getAvatarUrl(user.image)
                      : undefined;

                    return (
                      <Avatar
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
