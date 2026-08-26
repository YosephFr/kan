import type { DBSchema, IDBPDatabase } from "idb";
import { openDB } from "idb";

import type { CardCanvasScene } from "~/views/card/components/card-canvas-types";

const DATABASE_NAME = "kan-workspace-canvas";
const STORE_NAME = "drafts";
const MAX_LOCAL_GENERATIONS = 5;

export interface WorkspaceCanvasDraft {
  key: string;
  workspacePublicId: string;
  userId: string;
  baseVersion: number;
  baseHash: string | null;
  hash: string;
  scene: CardCanvasScene;
  bytes: number;
  elementCount: number;
  updatedAt: number;
  generation?: string;
  synced?: boolean;
}

interface WorkspaceCanvasDraftDatabase extends DBSchema {
  drafts: {
    key: string;
    value: WorkspaceCanvasDraft;
  };
}

let databasePromise: Promise<
  IDBPDatabase<WorkspaceCanvasDraftDatabase>
> | null = null;

const getDatabase = () => {
  databasePromise ??= openDB<WorkspaceCanvasDraftDatabase>(DATABASE_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    },
  });
  return databasePromise;
};

export const getWorkspaceCanvasDraftKey = (
  userId: string,
  workspacePublicId: string,
) => `${userId}:${workspacePublicId}`;

const getWorkspaceCanvasGenerationKey = (
  userId: string,
  workspacePublicId: string,
  generation: string,
) => `${getWorkspaceCanvasDraftKey(userId, workspacePublicId)}:${generation}`;

export const getLatestWorkspaceCanvasDraft = (
  drafts: readonly WorkspaceCanvasDraft[],
) =>
  [...drafts].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt || right.key.localeCompare(left.key),
  )[0] ?? null;

const getWorkspaceDrafts = async (
  database: IDBPDatabase<WorkspaceCanvasDraftDatabase>,
  userId: string,
  workspacePublicId: string,
) =>
  (await database.getAll(STORE_NAME)).filter(
    (draft) =>
      draft.userId === userId && draft.workspacePublicId === workspacePublicId,
  );

export const readWorkspaceCanvasDraft = async (
  userId: string,
  workspacePublicId: string,
) => {
  if (typeof indexedDB === "undefined") return null;
  const database = await getDatabase();
  return getLatestWorkspaceCanvasDraft(
    await getWorkspaceDrafts(database, userId, workspacePublicId),
  );
};

export const writeWorkspaceCanvasDraft = async (
  draft: WorkspaceCanvasDraft,
) => {
  if (typeof indexedDB === "undefined") return;
  const database = await getDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const generation = draft.generation ?? "legacy";
  await transaction.store.put({
    ...draft,
    key: getWorkspaceCanvasGenerationKey(
      draft.userId,
      draft.workspacePublicId,
      generation,
    ),
  });
  const drafts = (await transaction.store.getAll())
    .filter(
      (candidate) =>
        candidate.userId === draft.userId &&
        candidate.workspacePublicId === draft.workspacePublicId,
    )
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || right.key.localeCompare(left.key),
    );
  for (const candidate of drafts.slice(MAX_LOCAL_GENERATIONS)) {
    await transaction.store.delete(candidate.key);
  }
  await transaction.done;
};

export const clearWorkspaceCanvasDrafts = async (
  userId: string,
  workspacePublicId: string,
) => {
  if (typeof indexedDB === "undefined") return;
  const database = await getDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const drafts = (await transaction.store.getAll()).filter(
    (draft) =>
      draft.userId === userId && draft.workspacePublicId === workspacePublicId,
  );
  for (const draft of drafts) {
    await transaction.store.delete(draft.key);
  }
  await transaction.done;
};

export const claimWorkspaceCanvasDraft = async (
  userId: string,
  workspacePublicId: string,
) => {
  if (typeof indexedDB === "undefined") return null;
  const database = await getDatabase();
  return getLatestWorkspaceCanvasDraft(
    await getWorkspaceDrafts(database, userId, workspacePublicId),
  );
};

export type WorkspaceCanvasDraftResolution =
  | { kind: "remote" }
  | { kind: "draft"; draft: WorkspaceCanvasDraft }
  | { kind: "conflict"; draft: WorkspaceCanvasDraft };

export const resolveWorkspaceCanvasDraft = (
  draft: WorkspaceCanvasDraft | null,
  remoteVersion: number,
  remoteHash: string | null,
): WorkspaceCanvasDraftResolution => {
  if (!draft || draft.synced || draft.hash === remoteHash) {
    return { kind: "remote" };
  }
  if (draft.baseVersion === remoteVersion && draft.baseHash === remoteHash) {
    return { kind: "draft", draft };
  }
  return { kind: "conflict", draft };
};
