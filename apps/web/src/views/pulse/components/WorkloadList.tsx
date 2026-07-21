import { t } from "@lingui/core/macro";

import type { RouterOutputs } from "~/utils/api";

type Workload = RouterOutputs["pulse"]["summary"]["workload"];

interface WorkloadListProps {
  workload: Workload;
}

export function WorkloadList({ workload }: WorkloadListProps) {
  const maximum = Math.max(1, ...workload.map((item) => item.active));

  return (
    <section className="rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50">
      <div className="border-b border-light-300 p-5 dark:border-dark-300">
        <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {t`Team workload`}
        </h2>
        <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
          {t`Work in progress for balancing capacity, not performance ranking`}
        </p>
      </div>

      {workload.length === 0 ? (
        <p className="p-5 text-sm text-light-800 dark:text-dark-800">
          {t`There is no assigned work in progress.`}
        </p>
      ) : (
        <ul className="divide-y divide-light-300 dark:divide-dark-300">
          {workload.map((item, index) => {
            const name =
              item.memberPublicId === null ? t`Unassigned` : item.name;
            return (
              <li
                key={item.memberPublicId ?? `unassigned-${index}`}
                className="p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
                      {name}
                    </p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-sm bg-light-200 dark:bg-dark-200">
                      <div
                        className="h-full bg-sky-600 transition-[width] duration-700 dark:bg-sky-500"
                        style={{ width: `${(item.active / maximum) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold text-light-1000 dark:text-dark-1000">
                      {item.active}
                    </p>
                    <p className="text-[10px] text-light-800 dark:text-dark-800">
                      {t`active`}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-4 text-[11px] text-light-800 dark:text-dark-800">
                  <span>{t`${item.blocked} blocked`}</span>
                  <span>{t`${item.stalled} without movement`}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
