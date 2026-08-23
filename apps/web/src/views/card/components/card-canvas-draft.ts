import type { DBSchema, IDBPDatabase } from "idb";
import { openDB } from "idb";

import type { CardCanvasDraft } from "./card-canvas-types";

const DATABASE_NAME = "kan-card-canvas";
const STORE_NAME = "drafts";

interface CardCanvasDraftDatabase extends DBSchema {
  drafts: {
    key: string;
    value: CardCanvasDraft;
  };
}

let databasePromise: Promise<IDBPDatabase<CardCanvasDraftDatabase>> | null =
  null;

const getDatabase = () => {
  databasePromise ??= openDB<CardCanvasDraftDatabase>(DATABASE_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    },
  });
  return databasePromise;
};

export const getCardCanvasDraftKey = (userId: string, cardPublicId: string) =>
  `${userId}:${cardPublicId}`;

export const readCardCanvasDraft = async (
  userId: string,
  cardPublicId: string,
) => {
  if (typeof indexedDB === "undefined") return null;
  const database = await getDatabase();
  return (
    (await database.get(
      STORE_NAME,
      getCardCanvasDraftKey(userId, cardPublicId),
    )) ?? null
  );
};

export const writeCardCanvasDraft = async (draft: CardCanvasDraft) => {
  if (typeof indexedDB === "undefined") return;
  const database = await getDatabase();
  await database.put(STORE_NAME, draft);
};

export const deleteCardCanvasDraft = async (
  userId: string,
  cardPublicId: string,
) => {
  if (typeof indexedDB === "undefined") return;
  const database = await getDatabase();
  await database.delete(
    STORE_NAME,
    getCardCanvasDraftKey(userId, cardPublicId),
  );
};

export type CardCanvasDraftResolution =
  | { kind: "remote" }
  | { kind: "draft"; draft: CardCanvasDraft }
  | { kind: "conflict"; draft: CardCanvasDraft };

export const resolveCardCanvasDraft = (
  draft: CardCanvasDraft | null,
  remoteVersion: number,
  remoteHash: string | null,
): CardCanvasDraftResolution => {
  if (!draft || draft.hash === remoteHash) return { kind: "remote" };
  if (draft.baseVersion === remoteVersion && draft.baseHash === remoteHash) {
    return { kind: "draft", draft };
  }
  return { kind: "conflict", draft };
};
