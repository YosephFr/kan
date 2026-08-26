import type {
  CardCanvasScene,
  NormalizedCardCanvas,
} from "~/views/card/components/card-canvas-types";

export interface WorkspaceCanvasDraftPersistence {
  normalized: NormalizedCardCanvas;
  localPersisted: boolean;
  isCurrent: boolean;
}

export type PersistDraft =
  () => Promise<WorkspaceCanvasDraftPersistence | null>;
export type FlushDraft = (normalized: NormalizedCardCanvas) => Promise<void>;

export interface WorkspaceCanvasRemoteHead {
  scene: unknown;
  version: number;
  hash: string | null;
}

export interface UseWorkspaceCanvasOptions {
  workspacePublicId: string;
  userId: string | null;
  canEdit: boolean;
}

export const EMPTY_WORKSPACE_CANVAS_SCENE: CardCanvasScene = {
  elements: [],
  appState: {},
};

interface WorkspaceCanvasReconnectState {
  remoteHeadVerified: boolean;
  isDirty: boolean;
  hasConflict: boolean;
}

export const getWorkspaceCanvasReconnectAction = ({
  remoteHeadVerified,
  isDirty,
  hasConflict,
}: WorkspaceCanvasReconnectState) => {
  if (!remoteHeadVerified) return "refresh-head" as const;
  if (isDirty && !hasConflict) return "flush" as const;
  return "wait" as const;
};

export const getWorkspaceCanvasBlockingError = <T>(
  scene: CardCanvasScene | null,
  error: T,
) => (scene === null ? error : null);

export const canInitializeWorkspaceCanvas = (
  effectiveCanEdit: boolean,
  userId: string | null,
) => !effectiveCanEdit || userId !== null;

export const canPersistWorkspaceCanvasDraft = (
  userId: string | null,
  effectiveCanEdit: boolean,
  isDirty: boolean,
) => userId !== null && (effectiveCanEdit || isDirty);

export const getWorkspaceCanvasInitialOnline = () =>
  typeof navigator === "undefined" || navigator.onLine;

export const createWorkspaceCanvasDraftGeneration = () =>
  typeof crypto === "undefined" || typeof crypto.randomUUID !== "function"
    ? `${Date.now()}-${Math.random()}`
    : crypto.randomUUID();

export const getWorkspaceCanvasChangedAt = (previous: number) => {
  const now =
    typeof performance === "undefined"
      ? Date.now()
      : performance.timeOrigin + performance.now();
  return Math.max(now, previous + 0.001);
};

interface PreserveWorkspaceCanvasOnUnmountOptions {
  persistDraft: () => Promise<WorkspaceCanvasDraftPersistence | null>;
  canFlushServer: () => boolean;
  flushServer: (normalized: NormalizedCardCanvas) => Promise<void>;
  dispose: () => void;
}

export const preserveWorkspaceCanvasOnUnmount = async ({
  persistDraft,
  canFlushServer,
  flushServer,
  dispose,
}: PreserveWorkspaceCanvasOnUnmountOptions) => {
  try {
    let persistence = await persistDraft();
    for (
      let attempt = 0;
      persistence && !persistence.isCurrent && attempt < 3;
      attempt += 1
    ) {
      persistence = await persistDraft();
    }
    if (
      persistence?.isCurrent &&
      !persistence.localPersisted &&
      canFlushServer()
    ) {
      await flushServer(persistence.normalized);
    }
  } finally {
    dispose();
  }
};

interface ReplaceWorkspaceCanvasWithRemoteOptions {
  applyRemote: () => Promise<boolean>;
  discardLocalDraft: () => Promise<void>;
  persistRemoteDraft: () => Promise<boolean>;
}

export const replaceWorkspaceCanvasWithRemote = async ({
  applyRemote,
  discardLocalDraft,
  persistRemoteDraft,
}: ReplaceWorkspaceCanvasWithRemoteOptions) => {
  if (!(await applyRemote())) return "not-applied" as const;
  try {
    await discardLocalDraft();
  } catch {
    return "draft-preserved" as const;
  }
  return (await persistRemoteDraft())
    ? ("persisted" as const)
    : ("persist-failed" as const);
};
