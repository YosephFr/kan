import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import {
  HiCheckCircle,
  HiChevronRight,
  HiExclamationTriangle,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { getCardWorkspaceQueryValue } from "~/utils/card-workspace";

interface DevelopmentProgressProps {
  summary: {
    total: number;
    completed: number;
    blocked: number;
    progressPercent: number;
  };
  compact?: boolean;
  interactive?: boolean;
}

export function DevelopmentProgress({
  summary,
  compact = false,
  interactive = true,
}: DevelopmentProgressProps) {
  const router = useRouter();
  const completed = summary.total > 0 && summary.completed === summary.total;

  if (compact) {
    if (summary.total === 0) return null;

    return (
      <div
        className="mt-1.5 flex items-center gap-2"
        aria-label={t`Development progress: ${summary.completed} of ${summary.total} subtasks completed`}
      >
        <span className="text-[10px] font-medium text-light-700 dark:text-dark-700">
          {t`Development`}
        </span>
        <span
          role="progressbar"
          aria-label={t`Development progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.progressPercent}
          className="h-1 flex-1 overflow-hidden rounded-full bg-light-300 dark:bg-dark-400"
        >
          <span
            className={twMerge(
              "block h-full rounded-full transition-[width,background-color] duration-500",
              completed ? "bg-emerald-600" : "bg-blue-600",
            )}
            style={{ width: `${summary.progressPercent}%` }}
          />
        </span>
        <span className="text-[10px] tabular-nums text-light-700 dark:text-dark-700">
          {summary.completed}/{summary.total}
        </span>
      </div>
    );
  }

  const content = (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-light-1000 dark:text-dark-1000">
              {t`Development`}
            </p>
            <p className="mt-0.5 text-xs text-light-700 dark:text-dark-700">
              {summary.total === 0
                ? t`No subtasks yet`
                : t`${summary.completed} of ${summary.total} subtasks completed`}
            </p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-light-950 dark:text-dark-950">
            {summary.progressPercent}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={t`Development progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.progressPercent}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-light-300 dark:bg-dark-400"
        >
          <div
            className={twMerge(
              "h-full rounded-full transition-[width,background-color] duration-500",
              completed ? "bg-emerald-600" : "bg-blue-600",
            )}
            style={{ width: `${summary.progressPercent}%` }}
          />
        </div>
        {summary.blocked > 0 && (
          <p className="mt-2 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <HiExclamationTriangle className="h-4 w-4" aria-hidden="true" />
            {t`${summary.blocked} blocked`}
          </p>
        )}
        {completed && (
          <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <HiCheckCircle className="h-4 w-4" aria-hidden="true" />
            {t`All subtasks are complete. You can move this card to Done.`}
          </p>
        )}
      </div>
      {interactive && (
        <HiChevronRight
          className="h-4 w-4 shrink-0 text-light-700 dark:text-dark-700"
          aria-hidden="true"
        />
      )}
    </div>
  );

  if (!interactive) {
    return (
      <div className="border-y border-light-300 py-4 dark:border-dark-400">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        const nextQuery: Record<string, string | string[] | undefined> = {
          ...router.query,
          vista: getCardWorkspaceQueryValue("subtasks"),
        };
        delete nextQuery.view;
        void router.replace(
          {
            pathname: router.pathname,
            query: nextQuery,
          },
          undefined,
          { shallow: true },
        );
      }}
      className="w-full border-y border-light-300 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:border-dark-400 dark:focus-visible:ring-dark-800"
    >
      {content}
    </button>
  );
}
