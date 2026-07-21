import Link from "next/link";
import { t } from "@lingui/core/macro";
import { HiChevronRight } from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";

type Attention = RouterOutputs["pulse"]["summary"]["attention"];
type Reason = Attention[number]["reasons"][number];

interface AttentionListProps {
  attention: Attention;
  cardPrefix: string;
}

const reasonLabel = (reason: Reason) => {
  const labels: Record<Reason, string> = {
    blocked: t`Blocked`,
    overdue: t`Overdue`,
    stalled: t`Without movement`,
    unassigned: t`Unassigned`,
  };
  return labels[reason];
};

const reasonClass: Record<Reason, string> = {
  blocked: "text-red-700 dark:text-red-400",
  overdue: "text-red-700 dark:text-red-400",
  stalled: "text-amber-700 dark:text-amber-400",
  unassigned: "text-light-800 dark:text-dark-800",
};

export function AttentionList({ attention, cardPrefix }: AttentionListProps) {
  return (
    <section className="rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50">
      <div className="border-b border-light-300 p-5 dark:border-dark-300">
        <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {t`Attention now`}
        </h2>
        <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
          {t`Cards with signals that need a decision`}
        </p>
      </div>

      {attention.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`No immediate flow risks`}
          </p>
          <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
            {t`There are no blocked, overdue, stalled, or unassigned open cards.`}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-light-300 dark:divide-dark-300">
          {attention.map((card) => (
            <li key={card.cardPublicId}>
              <Link
                href={`/cards/${card.cardPublicId}`}
                className="group flex min-w-0 items-center gap-3 p-4 transition-colors hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-1000 dark:hover:bg-dark-100 dark:focus-visible:ring-dark-1000 sm:p-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {card.cardNumber !== null && (
                      <span className="shrink-0 text-[11px] text-light-700 dark:text-dark-700">
                        {cardPrefix}-{card.cardNumber}
                      </span>
                    )}
                    <p className="truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
                      {card.title}
                    </p>
                  </div>
                  <p className="mt-1 truncate text-xs text-light-800 dark:text-dark-800">
                    {card.boardName} · {card.listName}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    {card.reasons.map((reason) => (
                      <span key={reason} className={reasonClass[reason]}>
                        {reasonLabel(reason)}
                      </span>
                    ))}
                    <span className="text-light-700 dark:text-dark-700">
                      {card.inactiveDays === 1
                        ? t`1 day in this stage`
                        : t`${card.inactiveDays} days in this stage`}
                    </span>
                  </div>
                </div>
                <HiChevronRight className="h-4 w-4 shrink-0 text-light-700 transition-transform group-hover:translate-x-0.5 dark:text-dark-700" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
