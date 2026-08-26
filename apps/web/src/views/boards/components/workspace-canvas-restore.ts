interface WorkspaceCanvasRestoreCommitSuccess {
  status: "saved" | "unchanged";
  version: number;
}

interface WorkspaceCanvasRestoreCommitConflict {
  status: "conflict";
  remoteVersion: number;
}

interface RestoreWorkspaceCanvasRevisionOptions {
  commit: () => Promise<
    WorkspaceCanvasRestoreCommitSuccess | WorkspaceCanvasRestoreCommitConflict
  >;
  synchronizeRemote: () => Promise<boolean>;
  refreshHistory: () => Promise<unknown>;
}

export const restoreWorkspaceCanvasRevision = async ({
  commit,
  synchronizeRemote,
  refreshHistory,
}: RestoreWorkspaceCanvasRevisionOptions) => {
  const result = await commit();
  if (result.status === "conflict") return result;

  try {
    if (!(await synchronizeRemote())) {
      return {
        status: "restored-sync-failed" as const,
        version: result.version,
      };
    }
  } catch {
    return { status: "restored-sync-failed" as const, version: result.version };
  }

  try {
    await refreshHistory();
  } catch {
    return { status: "restored" as const, version: result.version };
  }
  return { status: "restored" as const, version: result.version };
};
