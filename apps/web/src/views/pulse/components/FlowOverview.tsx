import { t } from "@lingui/core/macro";

import type { RouterOutputs } from "~/utils/api";

type PulseSummary = RouterOutputs["pulse"]["summary"];
type StatusKey = PulseSummary["statuses"][number]["key"];

interface FlowOverviewProps {
  statuses: PulseSummary["statuses"];
  totals: PulseSummary["totals"];
  checklist: PulseSummary["checklist"];
}

const statusClass: Record<StatusKey, string> = {
  planned: "bg-light-500 dark:bg-dark-500",
  inProgress: "bg-sky-600 dark:bg-sky-500",
  blocked: "bg-red-600 dark:bg-red-500",
  done: "bg-emerald-600 dark:bg-emerald-500",
  other: "bg-amber-500 dark:bg-amber-400",
};

const statusLabel = (key: StatusKey) => {
  const labels: Record<StatusKey, string> = {
    planned: t`Planned`,
    inProgress: t`In progress`,
    blocked: t`Blocked`,
    done: t`Done`,
    other: t`Other stage`,
  };
  return labels[key];
};

export function FlowOverview({
  statuses,
  totals,
  checklist,
}: FlowOverviewProps) {
  const total = statuses.reduce((sum, status) => sum + status.count, 0);
  const risks = [
    { label: t`Open`, value: totals.open },
    { label: t`Blocked`, value: totals.blocked },
    { label: t`Overdue`, value: totals.overdue },
    { label: t`Unassigned`, value: totals.unassigned },
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50">
      <div className="p-5">
        <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {t`Current flow`}
        </h2>
        <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
          {t`Live distribution across active boards`}
        </p>

        {total === 0 ? (
          <p className="mt-8 text-sm text-light-800 dark:text-dark-800">
            {t`There are no cards to measure yet.`}
          </p>
        ) : (
          <>
            <div
              className="mt-7 flex h-3 w-full overflow-hidden rounded-sm bg-light-200 dark:bg-dark-200"
              role="img"
              aria-label={t`Distribution of cards by stage`}
            >
              {statuses.map((status) =>
                status.count > 0 ? (
                  <div
                    key={status.key}
                    className={statusClass[status.key]}
                    style={{ width: `${(status.count / total) * 100}%` }}
                    title={`${statusLabel(status.key)}: ${status.count}`}
                  />
                ) : null,
              )}
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 text-xs">
              {statuses.map((status) => (
                <li
                  key={status.key}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex min-w-0 items-center gap-2 text-light-900 dark:text-dark-900">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-sm ${statusClass[status.key]}`}
                    />
                    <span className="truncate">{statusLabel(status.key)}</span>
                  </span>
                  <span className="font-semibold text-light-1000 dark:text-dark-1000">
                    {status.count}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 border-t border-light-300 dark:border-dark-300">
        {risks.map((risk, index) => (
          <div
            key={risk.label}
            className={`p-4 ${index % 2 === 1 ? "border-l border-light-300 dark:border-dark-300" : ""} ${index > 1 ? "border-t border-light-300 dark:border-dark-300" : ""}`}
          >
            <p className="text-[11px] text-light-800 dark:text-dark-800">
              {risk.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-light-1000 dark:text-dark-1000">
              {risk.value}
            </p>
          </div>
        ))}
      </div>

      <div className="border-t border-light-300 p-5 dark:border-dark-300">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-xs font-semibold text-light-1000 dark:text-dark-1000">
              {t`Checklist progress`}
            </h3>
            <p className="mt-1 text-[11px] text-light-800 dark:text-dark-800">
              {t`Only open cards`}
            </p>
          </div>
          <p className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {checklist.percent === null ? t`No items` : `${checklist.percent}%`}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={checklist.percent ?? 0}
          className="mt-3 h-2 overflow-hidden rounded-sm bg-light-200 dark:bg-dark-200"
        >
          <div
            className="h-full bg-light-1000 transition-[width] duration-700 dark:bg-dark-1000"
            style={{ width: `${checklist.percent ?? 0}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-light-800 dark:text-dark-800">
          {t`${checklist.completed} of ${checklist.total} completed`}
        </p>
      </div>
    </section>
  );
}
