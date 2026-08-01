import Link from "next/link";
import { t } from "@lingui/core/macro";
import { HiChevronRight } from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";
import Avatar from "~/components/Avatar";
import { getAvatarUrl } from "~/utils/helpers";
import { buildPulseDetailPath } from "~/utils/navigation";

type Team = RouterOutputs["pulse"]["portfolio"]["team"];

export function TeamProgress({
  team,
  period,
}: {
  team: Team;
  period: "week" | "month";
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50">
      <div className="border-b border-light-300 p-5 dark:border-dark-300">
        <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {t`Team progress by company`}
        </h2>
        <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
          {t`Cards each person moved between stages; this measures recorded progress, not hours or a performance ranking`}
        </p>
      </div>

      {team.length === 0 ? (
        <p className="p-6 text-sm text-light-800 dark:text-dark-800">
          {t`There are no attributed movements in the accessible companies.`}
        </p>
      ) : (
        <div className="divide-y divide-light-300 dark:divide-dark-300">
          {team.map((member) => (
            <article
              key={member.publicId}
              className="grid gap-5 p-5 xl:grid-cols-[220px_minmax(0,1fr)] xl:items-start"
            >
              <div className="flex items-center gap-3">
                <Avatar
                  name={member.name}
                  email=""
                  imageUrl={
                    member.image ? getAvatarUrl(member.image) : undefined
                  }
                  size="md"
                />
                <div>
                  <h3 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
                    {member.name}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-light-700 dark:text-dark-700">
                    {t`${member.totalAdvanced} advanced · ${member.totalDelivered} delivered`}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {member.companies.map((company) => (
                  <Link
                    key={company.workspacePublicId}
                    href={buildPulseDetailPath({
                      metric: "advanced",
                      period,
                      workspacePublicId: company.workspacePublicId,
                      memberPublicId: company.memberPublicId,
                    })}
                    className="group flex min-w-0 items-center justify-between gap-3 rounded-md border border-light-300 px-3 py-3 transition-colors hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 dark:border-dark-300 dark:hover:bg-dark-100 dark:focus-visible:ring-dark-1000"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-light-900 dark:text-dark-900">
                        {company.workspaceName}
                      </span>
                      <span className="mt-1 block text-[10px] text-light-700 dark:text-dark-700">
                        {t`${company.delivered} delivered`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-lg font-semibold text-light-1000 dark:text-dark-1000">
                        {company.advanced}
                      </span>
                      <HiChevronRight className="h-4 w-4 text-light-600 transition-transform group-hover:translate-x-0.5 dark:text-dark-600" />
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
