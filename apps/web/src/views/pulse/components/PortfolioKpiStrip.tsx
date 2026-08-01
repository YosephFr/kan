import Link from "next/link";
import { t } from "@lingui/core/macro";
import {
  HiOutlineArrowTrendingUp,
  HiOutlineCheckCircle,
  HiOutlineFolderOpen,
  HiOutlinePauseCircle,
} from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";
import { buildPulseDetailPath } from "~/utils/navigation";

type Totals = RouterOutputs["pulse"]["portfolio"]["totals"];

export function PortfolioKpiStrip({
  totals,
  period,
}: {
  totals: Totals;
  period: "week" | "month";
}) {
  const metrics = [
    {
      metric: "advanced" as const,
      label: t`Advanced`,
      value: totals.advanced,
      detail: t`Cards that changed stage`,
      icon: HiOutlineArrowTrendingUp,
      iconClass: "text-sky-700 dark:text-sky-400",
    },
    {
      metric: "delivered" as const,
      label: t`Delivered`,
      value: totals.delivered,
      detail: t`Cards moved to done`,
      icon: HiOutlineCheckCircle,
      iconClass: "text-emerald-700 dark:text-emerald-400",
    },
    {
      metric: "stalled" as const,
      label: t`Without movement`,
      value: totals.stalled,
      detail: t`Current open work`,
      icon: HiOutlinePauseCircle,
      iconClass: "text-amber-700 dark:text-amber-400",
    },
    {
      metric: "open" as const,
      label: t`Open`,
      value: totals.open,
      detail: t`Current cards across all companies`,
      icon: HiOutlineFolderOpen,
      iconClass: "text-light-800 dark:text-dark-800",
    },
  ];

  return (
    <section
      aria-label={t`Company progress metrics`}
      className="grid overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50 sm:grid-cols-2 xl:grid-cols-4"
    >
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <Link
            key={metric.metric}
            href={buildPulseDetailPath({ metric: metric.metric, period })}
            className={`group flex min-h-32 flex-col justify-between p-5 transition-colors hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-1000 dark:hover:bg-dark-100 dark:focus-visible:ring-dark-1000 ${
              index > 0
                ? "border-t border-light-300 dark:border-dark-300 sm:border-l sm:border-t-0"
                : ""
            } ${index === 2 ? "sm:border-l-0 xl:border-l" : ""} ${
              index >= 2 ? "sm:border-t xl:border-t-0" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-sm font-medium text-light-900 dark:text-dark-900">
              <span className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${metric.iconClass}`} />
                {metric.label}
              </span>
              <HiOutlineArrowTrendingUp className="h-4 w-4 -rotate-45 text-light-600 transition-transform group-hover:translate-x-0.5 dark:text-dark-600" />
            </div>
            <div className="mt-5">
              <p className="text-3xl font-semibold tracking-tight text-light-1000 dark:text-dark-1000">
                {metric.value}
              </p>
              <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
                {metric.detail}
              </p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
