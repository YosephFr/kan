import { useRouter } from "next/navigation";
import { t } from "@lingui/core/macro";
import { HiChevronRight } from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";
import { WorkspaceLogo } from "~/components/WorkspaceLogo";
import { useWorkspace } from "~/providers/workspace";
import { AttentionReasons } from "./AttentionList";

type Attention = RouterOutputs["pulse"]["portfolio"]["attention"];

export function PortfolioAttentionList({
  attention,
}: {
  attention: Attention;
}) {
  const router = useRouter();
  const { workspace, availableWorkspaces, switchWorkspace } = useWorkspace();

  const openCard = (card: Attention[number]) => {
    const destination = `/cards/${card.cardPublicId}`;
    if (workspace.publicId === card.workspacePublicId) {
      router.push(destination);
      return;
    }

    const targetWorkspace = availableWorkspaces.find(
      (item) => item.publicId === card.workspacePublicId,
    );
    if (targetWorkspace) {
      switchWorkspace(targetWorkspace, destination);
      return;
    }

    router.push(destination);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50">
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
            {t`There are no urgent, blocked, overdue, stalled, or unassigned open cards.`}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-light-300 dark:divide-dark-300">
          {attention.map((card) => (
            <li key={card.cardPublicId}>
              <button
                type="button"
                onClick={() => openCard(card)}
                className="group flex w-full min-w-0 items-center gap-3 p-4 text-left transition-colors hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-1000 dark:hover:bg-dark-100 dark:focus-visible:ring-dark-1000 sm:p-5"
              >
                <WorkspaceLogo
                  name={card.workspaceName}
                  logo={card.workspaceLogo}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    {card.cardNumber !== null && (
                      <span className="shrink-0 text-[11px] text-light-700 dark:text-dark-700">
                        {card.cardPrefix}-{card.cardNumber}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
                      {card.title}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-light-800 dark:text-dark-800">
                    {card.workspaceName} · {card.boardName} · {card.listName}
                  </span>
                  <AttentionReasons
                    reasons={card.reasons}
                    inactiveDays={card.inactiveDays}
                  />
                </span>
                <HiChevronRight className="h-4 w-4 shrink-0 text-light-700 transition-transform group-hover:translate-x-0.5 dark:text-dark-700" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
