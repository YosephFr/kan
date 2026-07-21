import { t } from "@lingui/core/macro";
import {
  HiOutlineArrowPathRoundedSquare,
  HiOutlineCheckCircle,
  HiOutlinePauseCircle,
} from "react-icons/hi2";

interface KpiStripProps {
  delivered: number;
  stalled: number;
  cycleTimeHours: number | null;
  cycleSamples: number;
  periodLabel: string;
}

const formatCycleTime = (hours: number | null) => {
  if (hours === null) return t`No sample`;
  if (hours < 24) return t`${hours} h`;
  return t`${Math.round((hours / 24) * 10) / 10} d`;
};

export function KpiStrip({
  delivered,
  stalled,
  cycleTimeHours,
  cycleSamples,
  periodLabel,
}: KpiStripProps) {
  const metrics = [
    {
      label: t`Delivered`,
      value: delivered.toString(),
      detail: periodLabel,
      icon: HiOutlineCheckCircle,
      iconClass: "text-emerald-700 dark:text-emerald-400",
    },
    {
      label: t`Without movement`,
      value: stalled.toString(),
      detail: t`Current open work`,
      icon: HiOutlinePauseCircle,
      iconClass: "text-amber-700 dark:text-amber-400",
    },
    {
      label: t`Median cycle time`,
      value: formatCycleTime(cycleTimeHours),
      detail:
        cycleSamples === 1
          ? t`1 complete transition`
          : t`${cycleSamples} complete transitions`,
      icon: HiOutlineArrowPathRoundedSquare,
      iconClass: "text-sky-700 dark:text-sky-400",
    },
  ];

  return (
    <section
      aria-label={t`Key flow metrics`}
      className="grid overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50 md:grid-cols-3"
    >
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.label}
            className={`flex min-h-32 flex-col justify-between p-5 ${
              index > 0
                ? "border-t border-light-300 dark:border-dark-300 md:border-l md:border-t-0"
                : ""
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-light-900 dark:text-dark-900">
              <Icon className={`h-5 w-5 ${metric.iconClass}`} />
              <span>{metric.label}</span>
            </div>
            <div className="mt-5">
              <p className="text-3xl font-semibold tracking-tight text-light-1000 dark:text-dark-1000">
                {metric.value}
              </p>
              <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
                {metric.detail}
              </p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
