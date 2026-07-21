import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { useState } from "react";
import { HiArrowPath } from "react-icons/hi2";

import Button from "~/components/Button";
import { PageHead } from "~/components/PageHead";
import { useLocalisation } from "~/hooks/useLocalisation";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { AttentionList } from "./components/AttentionList";
import { FlowOverview } from "./components/FlowOverview";
import { KpiStrip } from "./components/KpiStrip";
import { ThroughputChart } from "./components/ThroughputChart";
import { WorkloadList } from "./components/WorkloadList";

type Period = "week" | "month";

function PulseSkeleton() {
  return (
    <div
      className="animate-pulse space-y-5"
      aria-label={t`Loading flow metrics`}
    >
      <div className="grid overflow-hidden rounded-lg border border-light-300 dark:border-dark-300 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-32 border-light-300 p-5 dark:border-dark-300 md:border-r last:md:border-r-0"
          >
            <div className="h-3 w-24 rounded-sm bg-light-300 dark:bg-dark-300" />
            <div className="mt-7 h-8 w-16 rounded-sm bg-light-300 dark:bg-dark-300" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <div className="h-72 rounded-lg bg-light-200 dark:bg-dark-200" />
        <div className="h-72 rounded-lg bg-light-200 dark:bg-dark-200" />
      </div>
      <div className="h-80 rounded-lg bg-light-200 dark:bg-dark-200" />
    </div>
  );
}

export default function PulseView() {
  const { workspace, hasLoaded } = useWorkspace();
  const { dateLocale } = useLocalisation();
  const [period, setPeriod] = useState<Period>("week");
  const workspaceReady = hasLoaded && workspace.publicId.length >= 12;
  const { data, error, isLoading, isFetching, refetch } =
    api.pulse.summary.useQuery(
      { workspacePublicId: workspace.publicId, period },
      {
        enabled: workspaceReady,
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
  const coverage = data
    ? data.coverage.cards === 0
      ? 100
      : Math.round(
          (data.coverage.cardsWithTransitions / data.coverage.cards) * 100,
        )
    : 0;

  return (
    <>
      <PageHead title={t`Pulse | ${workspace.name}`} />
      <main className="mx-auto min-h-full w-full max-w-[1380px] px-4 py-6 sm:px-6 md:px-10 md:py-10 lg:px-12">
        <header className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
              {t`Pulse`}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-light-800 dark:text-dark-800">
              {t`See flow, load, and risks across every active board in this workspace.`}
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
              disabled={!workspaceReady || isFetching}
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

        {!workspaceReady || isLoading ? (
          <PulseSkeleton />
        ) : error || !data ? (
          <section className="rounded-lg border border-red-300 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950/20">
            <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
              {t`Pulse could not be loaded`}
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
            <KpiStrip
              delivered={data.kpis.delivered}
              stalled={data.kpis.stalled}
              cycleTimeHours={data.kpis.cycleTimeHours}
              cycleSamples={data.coverage.cycleSamples}
              periodLabel={periodLabel}
            />

            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
              <ThroughputChart points={data.trend} period={period} />
              <FlowOverview
                statuses={data.statuses}
                totals={data.totals}
                checklist={data.checklist}
              />
            </div>

            <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.6fr)]">
              <WorkloadList workload={data.workload} />
              <AttentionList
                attention={data.attention}
                cardPrefix={data.workspace.cardPrefix}
              />
            </div>

            <footer className="flex flex-col gap-2 border-t border-light-300 py-4 text-[11px] text-light-700 dark:border-dark-300 dark:text-dark-700 sm:flex-row sm:items-center sm:justify-between">
              <p>
                {t`History coverage: ${coverage}% of cards have recorded list transitions. Cycle time only uses complete transitions.`}
              </p>
              <p className="shrink-0">
                {t`Without movement: ${data.configuration.inProgressStaleDays} d in progress · ${data.configuration.blockedStaleDays} d blocked · ${data.configuration.plannedStaleDays} d planned`}
              </p>
            </footer>
          </div>
        )}
      </main>
    </>
  );
}
