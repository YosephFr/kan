import Link from "next/link";
import { t } from "@lingui/core/macro";
import { HiChevronRight } from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";
import { WorkspaceLogo } from "~/components/WorkspaceLogo";
import { buildPulseDetailPath } from "~/utils/navigation";

type Companies = RouterOutputs["pulse"]["portfolio"]["companies"];

export function CompanyProgress({
  companies,
  period,
}: {
  companies: Companies;
  period: "week" | "month";
}) {
  const maximum = Math.max(
    1,
    ...companies.flatMap((company) => [company.advanced, company.stalled]),
  );

  return (
    <section
      id="companies"
      className="overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50"
    >
      <div className="border-b border-light-300 p-5 dark:border-dark-300">
        <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {t`Progress by company`}
        </h2>
        <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
          {t`Stage changes in the selected period compared with currently stalled work`}
        </p>
      </div>

      {companies.length === 0 ? (
        <p className="p-6 text-sm text-light-800 dark:text-dark-800">
          {t`There are no accessible companies to measure.`}
        </p>
      ) : (
        <div className="divide-y divide-light-300 dark:divide-dark-300">
          {companies.map((company) => (
            <article
              key={company.publicId}
              className="grid gap-5 p-5 lg:grid-cols-[minmax(180px,0.65fr)_minmax(260px,1.35fr)_minmax(310px,1fr)] lg:items-center"
            >
              <Link
                href={buildPulseDetailPath({
                  metric: "open",
                  period,
                  workspacePublicId: company.publicId,
                })}
                className="group flex min-w-0 items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 dark:focus-visible:ring-dark-1000"
              >
                <WorkspaceLogo
                  name={company.name}
                  logo={company.logo}
                  size="md"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-light-1000 dark:text-dark-1000">
                    {company.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-light-700 dark:text-dark-700">
                    {t`${company.boards} active boards · ${company.cards} cards`}
                  </span>
                </span>
                <HiChevronRight className="ml-auto h-4 w-4 shrink-0 text-light-600 transition-transform group-hover:translate-x-0.5 dark:text-dark-600" />
              </Link>

              <div
                className="space-y-3"
                aria-label={t`${company.name} movement`}
              >
                <div className="grid grid-cols-[88px_minmax(0,1fr)_32px] items-center gap-3">
                  <span className="text-[11px] text-light-800 dark:text-dark-800">
                    {t`Advanced`}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-sm bg-light-200 dark:bg-dark-200">
                    <span
                      className="block h-full bg-sky-600 transition-[width] duration-700 dark:bg-sky-500"
                      style={{
                        width:
                          company.advanced === 0
                            ? "0%"
                            : `${Math.max(2, (company.advanced / maximum) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="text-right text-xs font-semibold text-light-1000 dark:text-dark-1000">
                    {company.advanced}
                  </span>
                </div>
                <div className="grid grid-cols-[88px_minmax(0,1fr)_32px] items-center gap-3">
                  <span className="text-[11px] text-light-800 dark:text-dark-800">
                    {t`Stalled`}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-sm bg-light-200 dark:bg-dark-200">
                    <span
                      className="block h-full bg-amber-600 transition-[width] duration-700 dark:bg-amber-500"
                      style={{
                        width:
                          company.stalled === 0
                            ? "0%"
                            : `${Math.max(2, (company.stalled / maximum) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="text-right text-xs font-semibold text-light-1000 dark:text-dark-1000">
                    {company.stalled}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-light-300 dark:border-dark-300 sm:grid-cols-4">
                {[
                  {
                    label: t`Advanced`,
                    value: company.advanced,
                    metric: "advanced" as const,
                  },
                  {
                    label: t`Delivered`,
                    value: company.delivered,
                    metric: "delivered" as const,
                  },
                  {
                    label: t`Stalled`,
                    value: company.stalled,
                    metric: "stalled" as const,
                  },
                  {
                    label: t`Open`,
                    value: company.open,
                    metric: "open" as const,
                  },
                ].map((stat, index) => (
                  <Link
                    key={stat.metric}
                    href={buildPulseDetailPath({
                      metric: stat.metric,
                      period,
                      workspacePublicId: company.publicId,
                    })}
                    className={`px-3 py-2.5 text-center transition-colors hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-1000 dark:hover:bg-dark-100 dark:focus-visible:ring-dark-1000 ${
                      index === 1
                        ? "border-l border-light-300 dark:border-dark-300"
                        : index === 2
                          ? "border-t border-light-300 dark:border-dark-300 sm:border-l sm:border-t-0"
                          : index === 3
                            ? "border-l border-t border-light-300 dark:border-dark-300 sm:border-t-0"
                            : ""
                    }`}
                  >
                    <span className="block text-base font-semibold text-light-1000 dark:text-dark-1000">
                      {stat.value}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-light-700 dark:text-dark-700">
                      {stat.label}
                    </span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
