import { and, asc, count, eq, inArray, isNull, ne, or } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { MemberRole, MemberStatus } from "@kan/db/schema";
import {
  cardActivities,
  cards,
  cardSubtasks,
  notifications,
  workspaceMembers,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";

export const getActiveCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(workspaceMembers)
    .where(
      and(
        isNull(workspaceMembers.deletedAt),
        eq(workspaceMembers.status, "active"),
      ),
    );

  return result[0]?.count ?? 0;
};

export const getCountByWorkspaceId = async (
  db: dbClient,
  workspaceId: number,
) => {
  const result = await db
    .select({ count: count() })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        isNull(workspaceMembers.deletedAt),
        or(
          eq(workspaceMembers.status, "active"),
          eq(workspaceMembers.status, "invited"),
        ),
      ),
    );

  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  memberInput: {
    userId: string | null;
    email: string;
    workspaceId: number;
    createdBy: string;
    role: MemberRole;
    roleId?: number | null;
    status: MemberStatus;
  },
) => {
  const [result] = await db
    .insert(workspaceMembers)
    .values({
      publicId: generateUID(),
      email: memberInput.email,
      userId: memberInput.userId,
      workspaceId: memberInput.workspaceId,
      createdBy: memberInput.createdBy,
      role: memberInput.role,
      roleId: memberInput.roleId ?? null,
      status: memberInput.status,
    })
    .returning({
      id: workspaceMembers.id,
      publicId: workspaceMembers.publicId,
    });

  return result;
};

export const getByPublicId = async (db: dbClient, publicId: string) => {
  return db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.publicId, publicId),
  });
};

export const getById = async (db: dbClient, memberId: number) => {
  return db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.id, memberId),
  });
};

export const getByPublicIdsWithUsers = async (
  db: dbClient,
  memberPublicIds: string[],
  workspaceId?: number,
) => {
  return db.query.workspaceMembers.findMany({
    where: (members, { inArray: inArrayFn, eq, and, isNull: isNullFn }) => {
      const conditions = [inArrayFn(members.publicId, memberPublicIds)];

      if (workspaceId) {
        conditions.push(eq(members.workspaceId, workspaceId));
      }

      conditions.push(eq(members.status, "active"));
      conditions.push(isNullFn(members.deletedAt));

      return and(...conditions);
    },
    with: {
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
};

export const getByEmailAndStatus = async (
  db: dbClient,
  email: string,
  status: MemberStatus,
) => {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.email, email),
      eq(workspaceMembers.status, status),
      isNull(workspaceMembers.deletedAt),
    ),
  });
};

export const acceptInvite = async (
  db: dbClient,
  args: { memberId: number; userId: string },
) => {
  const [result] = await db
    .update(workspaceMembers)
    .set({ status: "active", userId: args.userId })
    .where(eq(workspaceMembers.id, args.memberId))
    .returning({
      id: workspaceMembers.id,
      publicId: workspaceMembers.publicId,
    });

  return result;
};

const SOFT_DELETE_MAX_ATTEMPTS = 3;

export const softDeleteMemberAttempt = async (
  db: dbClient,
  args: {
    memberId: number;
    deletedAt: Date;
    deletedBy: string;
  },
  hooks?: { afterInitialCardLocks?: (tx: DbTransaction) => Promise<void> },
) => {
  return db.transaction(async (tx) => {
    const initialOwnedSubtasks = await tx
      .select({ cardId: cardSubtasks.cardId })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.ownerWorkspaceMemberId, args.memberId));
    const initialCardIds = [
      ...new Set(initialOwnedSubtasks.map((subtask) => subtask.cardId)),
    ].sort((a, b) => a - b);
    if (initialCardIds.length > 0) {
      await tx
        .select({ id: cards.id })
        .from(cards)
        .where(inArray(cards.id, initialCardIds))
        .orderBy(asc(cards.id))
        .for("update");
    }
    await hooks?.afterInitialCardLocks?.(tx);

    const [member] = await tx
      .select({
        id: workspaceMembers.id,
        publicId: workspaceMembers.publicId,
        userId: workspaceMembers.userId,
      })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, args.memberId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!member) return { status: "not_found" as const };

    const finalOwnedCards = await tx
      .select({ cardId: cardSubtasks.cardId })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.ownerWorkspaceMemberId, member.id));
    if (
      finalOwnedCards.some(
        (subtask) => !initialCardIds.includes(subtask.cardId),
      )
    ) {
      return { status: "retry" as const };
    }

    const [result] = await tx
      .update(workspaceMembers)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(eq(workspaceMembers.id, member.id))
      .returning({
        id: workspaceMembers.id,
        publicId: workspaceMembers.publicId,
      });
    if (!result) return { status: "not_found" as const };

    const ownedSubtasks = await tx
      .update(cardSubtasks)
      .set({ ownerWorkspaceMemberId: null, updatedAt: args.deletedAt })
      .where(eq(cardSubtasks.ownerWorkspaceMemberId, member.id))
      .returning({
        id: cardSubtasks.id,
        publicId: cardSubtasks.publicId,
        cardId: cardSubtasks.cardId,
      });
    if (ownedSubtasks.length > 0) {
      const subtaskIds = ownedSubtasks.map((subtask) => subtask.id);
      await tx.insert(cardActivities).values(
        ownedSubtasks.map((subtask) => ({
          publicId: generateUID(),
          type: "card.updated.subtask.updated" as const,
          cardId: subtask.cardId,
          subtaskPublicId: subtask.publicId,
          createdBy: args.deletedBy,
        })),
      );
      if (member.userId) {
        await tx
          .update(notifications)
          .set({ deletedAt: args.deletedAt, dedupeKey: null })
          .where(
            and(
              inArray(notifications.subtaskId, subtaskIds),
              eq(notifications.userId, member.userId),
              inArray(notifications.type, [
                "subtask.assigned",
                "subtask.due.soon",
                "subtask.due.overdue",
              ]),
              isNull(notifications.deletedAt),
            ),
          );
      }
    }

    return { status: "deleted" as const, member: result };
  });
};

export const softDelete = async (
  db: dbClient,
  args: {
    memberId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  for (let attempt = 0; attempt < SOFT_DELETE_MAX_ATTEMPTS; attempt += 1) {
    const result = await softDeleteMemberAttempt(db, args);
    if (result.status === "deleted") return result.member;
    if (result.status === "not_found") return undefined;
  }

  throw new Error("Member deletion could not stabilize owned cards");
};

export const unpauseAllMembers = async (db: dbClient, workspaceId: number) => {
  await db
    .update(workspaceMembers)
    .set({ status: "active" })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "paused"),
      ),
    );
};

export const pauseAllMembers = async (db: dbClient, workspaceId: number) => {
  await db
    .update(workspaceMembers)
    .set({ status: "paused" })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active"),
      ),
    );
};

export const getPreservableMemberId = async (
  db: dbClient,
  workspaceId: number,
  ownerUserId: string | null,
): Promise<string | null> => {
  if (ownerUserId) {
    const owner = await db.query.workspaceMembers.findFirst({
      columns: { userId: true },
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, ownerUserId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
      ),
    });
    if (owner?.userId) return owner.userId;
  }

  const admin = await db.query.workspaceMembers.findFirst({
    columns: { userId: true },
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.role, "admin"),
      eq(workspaceMembers.status, "active"),
      isNull(workspaceMembers.deletedAt),
    ),
    orderBy: (m, { asc }) => [asc(m.createdAt)],
  });
  if (admin?.userId) return admin.userId;

  const anyMember = await db.query.workspaceMembers.findFirst({
    columns: { userId: true },
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.status, "active"),
      isNull(workspaceMembers.deletedAt),
    ),
    orderBy: (m, { asc }) => [asc(m.createdAt)],
  });
  return anyMember?.userId ?? null;
};

export const pauseMembersExcept = async (
  db: dbClient,
  workspaceId: number,
  preserveUserId: string,
) => {
  await db
    .update(workspaceMembers)
    .set({ status: "paused" })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active"),
        or(
          isNull(workspaceMembers.userId),
          ne(workspaceMembers.userId, preserveUserId),
        ),
      ),
    );
};

export const updateRole = async (
  db: dbClient,
  args: {
    memberId: number;
    role: MemberRole;
    roleId: number | null;
  },
) => {
  const [result] = await db
    .update(workspaceMembers)
    .set({
      role: args.role,
      roleId: args.roleId,
      updatedAt: new Date(),
    })
    .where(eq(workspaceMembers.id, args.memberId))
    .returning({
      id: workspaceMembers.id,
      publicId: workspaceMembers.publicId,
      role: workspaceMembers.role,
    });

  return result;
};
