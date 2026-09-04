import { t } from "@lingui/core/macro";

import Button from "~/components/Button";
import { VisualWall } from "~/components/visual-wall/VisualWall";
import { useWorkspaceVisualWall } from "./use-workspace-visual-wall";

export interface WorkspaceVisualWallProps {
  workspacePublicId: string;
  workspaceName: string;
  canEdit: boolean;
}

export function WorkspaceVisualWall({
  workspacePublicId,
  workspaceName,
  canEdit,
}: WorkspaceVisualWallProps) {
  const wall = useWorkspaceVisualWall({ workspacePublicId, canEdit });

  if (wall.isLoading) {
    return (
      <div
        className="flex min-h-[28rem] items-center justify-center"
        role="status"
      >
        <div className="flex items-center gap-2 text-sm text-light-700 dark:text-dark-700">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-light-400 border-t-light-900 dark:border-dark-400 dark:border-t-dark-900" />
          {t`Loading visual references…`}
        </div>
      </div>
    );
  }

  if (wall.isError) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-light-700 dark:text-dark-700">
          {t`The visual references could not be loaded.`}
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void wall.retry()}
        >
          {t`Try again`}
        </Button>
      </div>
    );
  }

  return (
    <VisualWall
      label={t`Visual references for ${workspaceName}`}
      items={wall.items}
      canEdit={wall.canEdit}
      freeformUrl={wall.freeformUrl}
      isBusy={wall.isBusy}
      onFiles={wall.onFiles}
      onUpdate={wall.onUpdate}
      onRemove={wall.onRemove}
      onSetFreeformUrl={wall.onSetFreeformUrl}
    />
  );
}
