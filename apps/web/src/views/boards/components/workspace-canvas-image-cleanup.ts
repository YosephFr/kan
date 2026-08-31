export interface WorkspaceCanvasImageCleanupTarget {
  workspacePublicId: string;
  imagePublicId: string;
}

export const getWorkspaceCanvasImageCleanupKey = ({
  workspacePublicId,
  imagePublicId,
}: WorkspaceCanvasImageCleanupTarget) =>
  `${workspacePublicId}:${imagePublicId}`;

const isAlreadyDeleted = (error: unknown) =>
  error instanceof Error &&
  ["NOT_FOUND", "WORKSPACE_CANVAS_IMAGE_STILL_REFERENCED"].some(
    (code) => error.name.includes(code) || error.message.includes(code),
  );

export async function discardWorkspaceCanvasImage({
  target,
  remove,
}: {
  target: WorkspaceCanvasImageCleanupTarget;
  remove: (target: WorkspaceCanvasImageCleanupTarget) => Promise<unknown>;
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await remove(target);
      return true;
    } catch (error) {
      if (isAlreadyDeleted(error)) return true;
    }
  }
  return false;
}

export async function drainWorkspaceCanvasImageCleanup({
  targets,
  remove,
}: {
  targets: readonly WorkspaceCanvasImageCleanupTarget[];
  remove: (target: WorkspaceCanvasImageCleanupTarget) => Promise<unknown>;
}) {
  const failed: WorkspaceCanvasImageCleanupTarget[] = [];
  for (let index = 0; index < targets.length; index += 3) {
    const chunk = targets.slice(index, index + 3);
    const results = await Promise.all(
      chunk.map(async (target) => ({
        target,
        removed: await discardWorkspaceCanvasImage({ target, remove }),
      })),
    );
    failed.push(
      ...results.flatMap(({ target, removed }) => (removed ? [] : [target])),
    );
  }
  return failed;
}
