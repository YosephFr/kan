import { t } from "@lingui/core/macro";

import { WorkspaceVisualWall } from "./WorkspaceVisualWall";

interface WorkspaceGoalsSectionProps {
  workspacePublicId: string;
  workspaceName: string;
  canEdit: boolean;
}

export function WorkspaceGoalsSection({
  workspacePublicId,
  workspaceName,
  canEdit,
}: WorkspaceGoalsSectionProps) {
  return (
    <section
      className="mt-14 w-full min-w-0 border-t border-light-300 pb-12 pt-9 dark:border-dark-300"
      aria-labelledby="workspace-goals-heading"
    >
      <div className="mb-5">
        <h2
          id="workspace-goals-heading"
          className="text-base font-bold tracking-tight text-light-1000 dark:text-dark-1000"
        >
          {t`Visual references for ${workspaceName}`}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-light-700 dark:text-dark-700">
          {t`Upload images to see the work in progress, or open the shared Freeform board to edit ideas.`}
        </p>
      </div>
      <WorkspaceVisualWall
        key={workspacePublicId}
        workspacePublicId={workspacePublicId}
        workspaceName={workspaceName}
        canEdit={canEdit}
      />
    </section>
  );
}
