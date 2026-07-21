import { t } from "@lingui/core/macro";
import { format } from "date-fns";

import type { RouterOutputs } from "~/utils/api";
import { useLocalisation } from "~/hooks/useLocalisation";

type TrendPoint = RouterOutputs["pulse"]["summary"]["trend"][number];

interface ThroughputChartProps {
  points: TrendPoint[];
  period: "week" | "month";
}

export function ThroughputChart({ points, period }: ThroughputChartProps) {
  const { dateLocale } = useLocalisation();
  const maximum = Math.max(1, ...points.map((point) => point.delivered));
  const total = points.reduce((sum, point) => sum + point.delivered, 0);
  const axisPoints = [0, 4, 8, 11]
    .map((index) => points[index])
    .filter((point): point is TrendPoint => point !== undefined);

  return (
    <section className="rounded-lg border border-light-300 bg-light-50 p-5 dark:border-dark-300 dark:bg-dark-50">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`Delivery rhythm`}
          </h2>
          <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
            {period === "week" ? t`Last 12 weeks` : t`Last 12 months`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-light-1000 dark:text-dark-1000">
            {total}
          </p>
          <p className="text-[11px] text-light-800 dark:text-dark-800">
            {t`total delivered`}
          </p>
        </div>
      </div>

      <div role="img" aria-label={t`Deliveries over time`} className="mt-7">
        <div className="grid h-44 grid-cols-12 items-end gap-1.5 border-b border-light-300 px-1 dark:border-dark-300 sm:gap-2">
          {points.map((point) => {
            const height =
              point.delivered === 0
                ? 3
                : Math.max(12, (point.delivered / maximum) * 100);
            const label = format(
              new Date(point.startsAt),
              period === "week" ? "d MMM" : "MMM yy",
              { locale: dateLocale },
            );
            return (
              <div
                key={point.startsAt}
                className="flex h-full min-w-0 items-end"
                aria-label={t`${label}: ${point.delivered} delivered`}
              >
                <div className="relative flex h-full w-full items-end">
                  {point.delivered > 0 && (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold text-light-900 dark:text-dark-900"
                      style={{ bottom: `calc(${height}% + 5px)` }}
                    >
                      {point.delivered}
                    </span>
                  )}
                  <div
                    className={`w-full rounded-t-sm transition-[height] duration-700 ease-out ${
                      point.current
                        ? "bg-light-1000 dark:bg-dark-1000"
                        : "bg-light-500 dark:bg-dark-500"
                    }`}
                    style={{ height: `${height}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-light-800 dark:text-dark-800">
          {axisPoints.map((point) => (
            <span key={point.startsAt}>
              {format(
                new Date(point.startsAt),
                period === "week" ? "d MMM" : "MMM yy",
                { locale: dateLocale },
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
