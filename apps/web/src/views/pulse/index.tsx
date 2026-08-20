import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { useState } from "react";
import { HiArrowPath } from "react-icons/hi2";

import Button from "~/components/Button";
import { PageHead } from "~/components/PageHead";
import { useLocalisation } from "~/hooks/useLocalisation";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { CompanyProgress } from "./components/CompanyProgress";
import { PortfolioAttentionList } from "./components/PortfolioAttentionList";
import { PortfolioKpiStrip } from "./components/PortfolioKpiStrip";
import { TeamProgress } from "./components/TeamProgress";

type Period = "week" | "month";

function PortfolioSkeleton() {
  return (
    <div
      className="animate-pulse space-y-5"
      aria-label={t`Loading company progress`}
    >
      <div className="grid overflow-hidden rounded-lg border border-light-300 dark:border-dark-300 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-32 border-light-300 p-5 dark:border-dark-300 sm:border-l first:sm:border-l-0"
          >
            <div className="h-3 w-24 rounded-sm bg-light-300 dark:bg-dark-300" />
            <div className="mt-7 h-8 w-16 rounded-sm bg-light-300 dark:bg-dark-300" />
          </div>
        ))}
      </div>
      <div className="h-80 rounded-lg bg-light-200 dark:bg-dark-200" />
      <div className="h-72 rounded-lg bg-light-200 dark:bg-dark-200" />
    </div>
  );
}

export default function PulseView() {
  const { hasLoaded } = useWorkspace();
  const { dateLocale } = useLocalisation();
  const [period, setPeriod] = useState<Period>("week");
  const { data, error, isLoading, isFetching, refetch } =
    api.pulse.portfolio.useQuery(
      { period },
      {
        enabled: hasLoaded,
        refetchInterval: 15_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: "always",
      },
    );

  const periodLabel = data
    ? period === "week"
      ? `${format(new Date(data.period.startsAt), "d MMM", { locale: dateLocale })} – ${format(new Date(data.period.endsAt), "d MMM", { locale: dateLocale })}`
      : format(new Date(data.period.startsAt), "MMMM yyyy", {
          locale: dateLocale,
        })
    : "";
  const movementCoverage = data
    ? data.coverage.cards === 0
      ? 100
      : Math.round(
          (data.coverage.cardsWithTransitions / data.coverage.cards) * 100,
        )
    : 0;
  const attributionCoverage = data
    ? data.coverage.periodTransitions === 0
      ? 100
      : Math.round(
          (data.coverage.attributedPeriodTransitions /
            data.coverage.periodTransitions) *
            100,
        )
    : 0;

  return (
    <>
      <PageHead title={t`Dashboard | Companies`} />
      <main className="mx-auto min-h-full w-full max-w-[1380px] px-4 py-6 sm:px-6 md:px-10 md:py-10 lg:px-12">
        <header className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
                {t`Dashboard`}
              </h1>
              {data && (
                <span className="text-xs text-light-700 dark:text-dark-700">
                  {t`${data.totals.companies} companies`}
                </span>
              )}
            </div>
            <p className="mt-1 max-w-3xl text-sm text-light-800 dark:text-dark-800">
              {t`Compare progress, delivery, and stagnation across every company and see who moved the work forward.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-md border border-light-400 bg-light-100 p-0.5 dark:border-dark-400 dark:bg-dark-100"
              aria-label={t`Analysis period`}
            >
              {(["week", "month"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                  className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 dark:focus-visible:ring-dark-1000 ${
                    period === value
                      ? "bg-light-50 text-light-1000 shadow-sm dark:bg-dark-300 dark:text-dark-1000"
                      : "text-light-800 hover:text-light-1000 dark:text-dark-800 dark:hover:text-dark-1000"
                  }`}
                >
                  {value === "week" ? t`Week` : t`Month`}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void refetch()}
              disabled={!hasLoaded || isFetching}
              iconLeft={
                <HiArrowPath
                  className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                />
              }
            >
              {t`Refresh`}
            </Button>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-light-700 dark:text-dark-700">
          <span className="capitalize">{periodLabel}</span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500" />
            {data
              ? t`Updated at ${format(new Date(data.refreshedAt), "HH:mm:ss")}`
              : t`Automatic refresh every 15 seconds`}
          </span>
        </div>

        {!hasLoaded || isLoading ? (
          <PortfolioSkeleton />
        ) : error || !data ? (
          <section className="rounded-lg border border-red-300 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950/20">
            <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
              {t`Dashboard could not be loaded`}
            </h2>
            <p className="mt-1 text-sm text-red-800 dark:text-red-300">
              {t`Check the connection and try again.`}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => void refetch()}
            >
              {t`Try again`}
            </Button>
          </section>
        ) : (
          <div className="space-y-5">
            {(movementCoverage < 80 || attributionCoverage < 80) && (
              <section
                role="status"
                className="border-l-2 border-amber-600 bg-amber-50 px-4 py-3 text-xs text-amber-950 dark:border-amber-500 dark:bg-amber-950/20 dark:text-amber-200"
              >
                <p className="font-semibold">
                  {t`Movement history is still incomplete`}
                </p>
                <p className="mt-1">
                  {t`A zero may mean that no stage change was recorded, not necessarily that no work happened. Coverage will improve as the team uses the boards.`}
                </p>
              </section>
            )}
            <PortfolioKpiStrip totals={data.totals} period={period} />
            <PortfolioAttentionList attention={data.attention} />
            <CompanyProgress companies={data.companies} period={period} />
            <TeamProgress team={data.team} period={period} />

            <footer className="grid gap-2 border-t border-light-300 py-4 text-[11px] text-light-700 dark:border-dark-300 dark:text-dark-700 lg:grid-cols-2">
              <p>
                {t`Advanced counts each card once when it changed stage during the selected period. Delivered is included in advanced.`}
              </p>
              <p className="lg:text-right">
                {t`Data coverage: ${movementCoverage}% of cards have movement history · ${attributionCoverage}% of this period's movements identify their author`}
              </p>
              <p className="lg:col-span-2 lg:text-right">
                {t`Without movement: ${data.configuration.inProgressStaleDays} d in progress · ${data.configuration.blockedStaleDays} d blocked · ${data.configuration.plannedStaleDays} d planned`}
              </p>
            </footer>
          </div>
        )}
      </main>
    </>
  );
}
