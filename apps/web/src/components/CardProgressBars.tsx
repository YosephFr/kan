import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

import {
  getChecklistProgress,
  getDeadlineProgress,
} from "~/utils/card-presentation";

interface CardProgressBarsProps {
  checklists: { items: { completed: boolean }[] }[];
  startedAt?: Date | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  compact?: boolean;
}

const deadlinePresentation = (
  state: NonNullable<ReturnType<typeof getDeadlineProgress>>["state"],
) => {
  switch (state) {
    case "dueSoon":
      return {
        label: t`Less than 24 hours`,
        barClassName: "bg-amber-500",
        textClassName: "text-amber-700 dark:text-amber-400",
      };
    case "overdue":
      return {
        label: t`Overdue`,
        barClassName: "bg-red-600 dark:bg-red-500",
        textClassName: "text-red-600 dark:text-red-400",
      };
    case "completedOnTime":
      return {
        label: t`Completed on time`,
        barClassName: "bg-emerald-600 dark:bg-emerald-500",
        textClassName: "text-emerald-700 dark:text-emerald-400",
      };
    case "completedLate":
      return {
        label: t`Completed late`,
        barClassName: "bg-red-600 dark:bg-red-500",
        textClassName: "text-red-600 dark:text-red-400",
      };
    default:
      return {
        label: t`On track`,
        barClassName: "bg-sky-600 dark:bg-sky-500",
        textClassName: "text-light-700 dark:text-dark-700",
      };
  }
};

export default function CardProgressBars({
  checklists,
  startedAt,
  dueDate,
  completedAt,
  compact = false,
}: CardProgressBarsProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!startedAt || !dueDate || completedAt) return;
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, [completedAt, dueDate, startedAt]);

  const work = getChecklistProgress(checklists);
  const deadline = getDeadlineProgress({
    startedAt,
    dueDate,
    completedAt,
    now,
  });

  if (!work && !deadline) return null;

  const deadlineState = deadline ? deadlinePresentation(deadline.state) : null;

  return (
    <div className={twMerge("space-y-2", compact && "space-y-1.5")}>
      {work && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] leading-none">
            <span className="font-medium text-light-800 dark:text-dark-800">
              {t`Work`}
            </span>
            <span className="text-light-700 dark:text-dark-700">
              {work.completed}/{work.total}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={t`Work progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={work.percentage}
            className="h-1.5 overflow-hidden rounded-sm bg-light-300 dark:bg-dark-500"
          >
            <div
              className={twMerge(
                "h-full transition-[width] duration-500 ease-out",
                work.percentage === 100
                  ? "bg-emerald-600 dark:bg-emerald-500"
                  : "bg-sky-600 dark:bg-sky-500",
              )}
              style={{ width: `${work.percentage}%` }}
            />
          </div>
        </div>
      )}
      {deadline && deadlineState && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] leading-none">
            <span className="font-medium text-light-800 dark:text-dark-800">
              {t`Deadline`}
            </span>
            <span className={deadlineState.textClassName}>
              {deadlineState.label}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={t`Deadline progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={deadline.percentage}
            className="h-1.5 overflow-hidden rounded-sm bg-light-300 dark:bg-dark-500"
          >
            <div
              className={twMerge(
                "h-full transition-[width] duration-500 ease-out",
                deadlineState.barClassName,
              )}
              style={{ width: `${deadline.percentage}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
