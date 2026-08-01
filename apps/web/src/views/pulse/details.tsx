import Link from "next/link";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { HiArrowLeft, HiArrowPath, HiChevronRight } from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";
import type { PulseDetailMetric } from "~/utils/navigation";
import Button from "~/components/Button";
import { PageHead } from "~/components/PageHead";
import { WorkspaceLogo } from "~/components/WorkspaceLogo";
import { useLocalisation } from "~/hooks/useLocalisation";
import { api } from "~/utils/api";
import { APP_HOME_PATH } from "~/utils/navigation";

type DetailItem = RouterOutputs["pulse"]["detail"]["items"][number];
type Status = DetailItem["status"];

const getQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const isMetric = (value: string | undefined): value is PulseDetailMetric =>
  value === "advanced" ||
  value === "delivered" ||
  value === "stalled" ||
  value === "open";

const metricLabel = (metric: PulseDetailMetric) => {
  const labels: Record<PulseDetailMetric, string> = {
    advanced: t`Cards that advanced`,
    delivered: t`Delivered cards`,
    stalled: t`Cards without movement`,
    open: t`Open cards`,
  };
  return labels[metric];
};

const statusLabel = (status: Status) => {
  const labels: Record<Status, string> = {
    planned: t`Planned`,
    inProgress: t`In progress`,
    blocked: t`Blocked`,
    done: t`Done`,
    other: t`Other stage`,
  };
  return labels[status];
};

export default function PulseDetailsView() {
  const router = useRouter();
  const { dateLocale } = useLocalisation();
  const metricQuery = getQueryValue(router.query.metric);
  const periodQuery = getQueryValue(router.query.period);
  const workspacePublicId = getQueryValue(router.query.workspace);
  const memberPublicId = getQueryValue(router.query.member);
  const metric = isMetric(metricQuery) ? metricQuery : "advanced";
  const period = periodQuery === "month" ? "month" : "week";
  const { data, error, isLoading, isFetching, refetch } =
    api.pulse.detail.useQuery(
      {
        metric,
        period,
        workspacePublicId,
        memberPublicId,
      },
      {
        enabled: router.isReady,
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
  const title = metricLabel(metric);
  const scope = [data?.workspace?.name, data?.member?.name]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHead title={t`${title} | Dashboard`} />
      <main className="mx-auto min-h-full w-full max-w-[1100px] px-4 py-6 sm:px-6 md:px-10 md:py-10 lg:px-12">
        <Link
          href={APP_HOME_PATH}
          className="mb-6 inline-flex items-center gap-2 text-xs font-medium text-light-800 transition-colors hover:text-light-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 dark:text-dark-800 dark:hover:text-dark-1000 dark:focus-visible:ring-dark-1000"
        >
          <HiArrowLeft className="h-4 w-4" />
          {t`Back to Dashboard`}
        </Link>

        <header className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
              {title}
            </h1>
            <p className="mt-1 text-sm text-light-800 dark:text-dark-800">
              {scope || t`All accessible companies`} ·{" "}
              <span className="capitalize">{periodLabel}</span>
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            disabled={!router.isReady || isFetching}
            iconLeft={
              <HiArrowPath
                className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
            }
          >
            {t`Refresh`}
          </Button>
        </header>

        {isLoading || !router.isReady ? (
          <div
            className="animate-pulse space-y-3"
            aria-label={t`Loading detail`}
          >
            <div className="h-20 rounded-lg bg-light-200 dark:bg-dark-200" />
            <div className="h-20 rounded-lg bg-light-200 dark:bg-dark-200" />
            <div className="h-20 rounded-lg bg-light-200 dark:bg-dark-200" />
          </div>
        ) : error || !data ? (
          <section className="rounded-lg border border-red-300 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950/20">
            <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
              {t`The metric detail could not be loaded`}
            </h2>
            <p className="mt-1 text-sm text-red-800 dark:text-red-300">
              {t`Return to the Dashboard and try again.`}
            </p>
          </section>
        ) : (
          <section className="overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-light-300 p-5 dark:border-dark-300">
              <div>
                <p className="text-3xl font-semibold tracking-tight text-light-1000 dark:text-dark-1000">
                  {data.total}
                </p>
                <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
                  {data.total === 1 ? t`1 card` : t`${data.total} cards`}
                </p>
              </div>
              <p className="text-[11px] text-light-700 dark:text-dark-700">
                {t`Updated at ${format(new Date(data.refreshedAt), "HH:mm:ss")}`}
              </p>
            </div>

            {data.items.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
                  {t`No cards match this statistic`}
                </p>
                <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
                  {t`Change the period or return to the company overview.`}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-light-300 dark:divide-dark-300">
                {data.items.map((item) => (
                  <li key={item.cardPublicId}>
                    <Link
                      href={`/cards/${item.cardPublicId}`}
                      onClick={() =>
                        localStorage.setItem(
                          "workspacePublicId",
                          item.workspacePublicId,
                        )
                      }
                      className="group grid min-w-0 gap-4 p-4 transition-colors hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-1000 dark:hover:bg-dark-100 dark:focus-visible:ring-dark-1000 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-3">
                          {!data.workspace && (
                            <WorkspaceLogo
                              name={item.workspaceName}
                              logo={item.workspaceLogo}
                              size="sm"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-baseline gap-2">
                              {item.cardNumber !== null && (
                                <span className="shrink-0 text-[11px] text-light-700 dark:text-dark-700">
                                  {item.cardPrefix}-{item.cardNumber}
                                </span>
                              )}
                              <p className="truncate text-sm font-semibold text-light-1000 dark:text-dark-1000">
                                {item.title}
                              </p>
                            </div>
                            <p className="mt-1 truncate text-xs text-light-800 dark:text-dark-800">
                              {!data.workspace && `${item.workspaceName} · `}
                              {item.boardName} · {item.listName}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-light-700 dark:text-dark-700">
                          <span>{statusLabel(item.status)}</span>
                          {item.fromListName && item.toListName && (
                            <span>
                              {item.fromListName} → {item.toListName}
                            </span>
                          )}
                          {metric === "stalled" && (
                            <span>
                              {item.inactiveDays === 1
                                ? t`1 day without movement`
                                : t`${item.inactiveDays} days without movement`}
                            </span>
                          )}
                          {item.lastChangedAt && metric !== "stalled" && (
                            <span>
                              {format(
                                new Date(item.lastChangedAt),
                                "d MMM · HH:mm",
                                {
                                  locale: dateLocale,
                                },
                              )}
                            </span>
                          )}
                          {item.changedBy &&
                            metric !== "stalled" &&
                            metric !== "open" && (
                              <span>
                                {t`Moved by`} {item.changedBy}
                              </span>
                            )}
                          {item.assignees.length > 0 && (
                            <span>
                              {t`Assignees`}: {item.assignees.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <HiChevronRight className="hidden h-4 w-4 shrink-0 text-light-600 transition-transform group-hover:translate-x-0.5 dark:text-dark-600 sm:block" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {data.truncated && (
              <p className="border-t border-light-300 p-4 text-center text-[11px] text-light-700 dark:border-dark-300 dark:text-dark-700">
                {t`Showing the first 200 cards.`}
              </p>
            )}
          </section>
        )}
      </main>
    </>
  );
}
