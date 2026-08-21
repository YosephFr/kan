import { and, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { ListStatus } from "@kan/db/schema";
import { boards, labels, lists, workspaces } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { inferListStatus } from "./list.repo";
import { WorkspaceChangedError } from "./workspace-boundary";

interface BoardSetupInput {
  publicId?: string;
  name: string;
  createdBy: string;
  workspaceId: number;
  importId?: number;
  slug: string;
  type?: "regular" | "template";
  sourceBoardId?: number;
  lists: {
    publicId?: string;
    name: string;
    status?: ListStatus | null;
    colourCode?: string | null;
  }[];
  labels: {
    publicId?: string;
    name: string;
    colourCode: string;
  }[];
}

export const createWithSetup = async (db: dbClient, input: BoardSetupInput) =>
  db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(eq(workspaces.id, input.workspaceId), isNull(workspaces.deletedAt)),
      )
      .limit(1)
      .for("share");
    if (!workspace) throw new WorkspaceChangedError();

    const [board] = await tx
      .insert(boards)
      .values({
        publicId: input.publicId ?? generateUID(),
        name: input.name,
        createdBy: input.createdBy,
        workspaceId: input.workspaceId,
        importId: input.importId,
        slug: input.slug,
        type: input.type ?? "regular",
        sourceBoardId: input.sourceBoardId,
      })
      .returning({
        id: boards.id,
        publicId: boards.publicId,
        name: boards.name,
      });
    if (!board) throw new Error("Failed to create board");

    if (input.lists.length > 0) {
      await tx.insert(lists).values(
        input.lists.map((list, index) => ({
          publicId: list.publicId ?? generateUID(),
          name: list.name,
          createdBy: input.createdBy,
          boardId: board.id,
          index,
          importId: input.importId,
          status:
            list.status === undefined
              ? inferListStatus(list.name)
              : list.status,
          colourCode: list.colourCode ?? null,
        })),
      );
    }

    if (input.labels.length > 0) {
      await tx.insert(labels).values(
        input.labels.map((label) => ({
          publicId: label.publicId ?? generateUID(),
          name: label.name,
          colourCode: label.colourCode,
          createdBy: input.createdBy,
          boardId: board.id,
          importId: input.importId,
        })),
      );
    }

    return board;
  });
