import Link from "next/link";
import { t } from "@lingui/core/macro";
import {
  HiChevronRight,
  HiExclamationTriangle,
  HiOutlineClock,
  HiOutlinePauseCircle,
  HiOutlineUserCircle,
} from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";

type Attention = RouterOutputs["pulse"]["summary"]["attention"];
export type AttentionReason = Attention[number]["reasons"][number];

interface AttentionListProps {
  attention: Attention;
  cardPrefix: string;
}

const reasonPresentation = (reason: AttentionReason) => {
  const presentations: Record<
    AttentionReason,
    {
      label: string;
      className: string;
      icon: typeof HiExclamationTriangle;
    }
  > = {
    urgent: {
      label: t`Urgent priority`,
      className: "text-red-700 dark:text-red-400",
      icon: HiExclamationTriangle,
    },
    blocked: {
      label: t`Blocked`,
      className: "text-red-700 dark:text-red-400",
      icon: HiOutlinePauseCircle,
    },
    overdue: {
      label: t`Overdue`,
      className: "text-red-700 dark:text-red-400",
      icon: HiOutlineClock,
    },
    subtaskBlocked: {
      label: t`Blocked subtask`,
      className: "text-red-700 dark:text-red-400",
      icon: HiOutlinePauseCircle,
    },
    subtaskOverdue: {
      label: t`Overdue subtask`,
      className: "text-red-700 dark:text-red-400",
      icon: HiOutlineClock,
    },
    stalled: {
      label: t`Without movement`,
      className: "text-amber-700 dark:text-amber-400",
      icon: HiOutlinePauseCircle,
    },
    unassigned: {
      label: t`Unassigned`,
      className: "text-light-800 dark:text-dark-800",
      icon: HiOutlineUserCircle,
    },
  };
  return presentations[reason];
};

export function AttentionReasons({
  reasons,
  inactiveDays,
}: {
  reasons: AttentionReason[];
  inactiveDays: number;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      {reasons.map((reason) => {
        const presentation = reasonPresentation(reason);
        const Icon = presentation.icon;
        return (
          <span
            key={reason}
            className={`inline-flex items-center gap-1 ${presentation.className}`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {presentation.label}
          </span>
        );
      })}
      <span className="text-light-700 dark:text-dark-700">
        {inactiveDays === 1
          ? t`1 day in this stage`
          : `${inactiveDays} ${t`days in this stage`}`}
      </span>
    </div>
  );
}

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
            {t`There are no urgent, blocked, overdue, stalled, or unassigned open cards or subtasks.`}
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
                  <AttentionReasons
                    reasons={card.reasons}
                    inactiveDays={card.inactiveDays}
                  />
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
