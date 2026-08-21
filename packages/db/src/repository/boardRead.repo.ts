import { and, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { boards } from "@kan/db/schema";

import type { BoardReadFilters, BoardSlugReadFilters } from "./board.repo";
import { queryByPublicId, queryBySlug } from "./board.repo";
import { getSummariesByCardPublicIds } from "./cardPipeline.repo";
import { getSummariesByCardPublicIds as getResourceSummariesByCardPublicIds } from "./cardResource.repo";
import {
  lockBoardTreeInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

export const getByPublicIdGuarded = async (
  db: dbClient,
  args: {
    boardPublicId: string;
    userId: string;
    expectedWorkspaceId: number;
    requirePublic: boolean;
    filters: BoardReadFilters;
  },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(eq(boards.publicId, args.boardPublicId), isNull(boards.deletedAt)),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    await lockBoardTreeInWorkspace(tx, candidate.id, args.expectedWorkspaceId, {
      requirePublic: args.requirePublic,
    });
    const board = await queryByPublicId(
      tx,
      args.boardPublicId,
      args.userId,
      args.filters,
    );
    if (!board) throw new WorkspaceChangedError();
    const cardPublicIds = board.lists.flatMap((list) =>
      list.cards.map((card) => card.publicId),
    );
    const [summaries, resourceSummaries] = await Promise.all([
      getSummariesByCardPublicIds(tx, cardPublicIds),
      getResourceSummariesByCardPublicIds(tx, cardPublicIds),
    ]);
    return { board, summaries, resourceSummaries };
  });

export const getBySlugGuarded = async (
  db: dbClient,
  args: {
    boardSlug: string;
    expectedWorkspaceId: number;
    filters: BoardSlugReadFilters;
  },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          eq(boards.slug, args.boardSlug),
          eq(boards.workspaceId, args.expectedWorkspaceId),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    await lockBoardTreeInWorkspace(tx, candidate.id, args.expectedWorkspaceId, {
      requirePublic: true,
    });
    const board = await queryBySlug(
      tx,
      args.boardSlug,
      args.expectedWorkspaceId,
      args.filters,
    );
    if (!board) throw new WorkspaceChangedError();
    const cardPublicIds = board.lists.flatMap((list) =>
      list.cards.map((card) => card.publicId),
    );
    const [summaries, resourceSummaries] = await Promise.all([
      getSummariesByCardPublicIds(tx, cardPublicIds),
      getResourceSummariesByCardPublicIds(tx, cardPublicIds),
    ]);
    return { board, summaries, resourceSummaries };
  });
