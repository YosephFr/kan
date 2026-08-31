import { and, count, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  users,
  workspaceCanvasImages,
  workspaceCanvasImageStorageDeletions,
  workspaceCanvasImageUploadSessions,
} from "@kan/db/schema";
import {
  generateUID,
  getWorkspaceCanvasImageQuotaBytes,
  hasWorkspaceCanvasActiveCapacity,
  hasWorkspaceCanvasPendingCapacity,
  hasWorkspaceCanvasPhysicalCapacity,
  MAX_PENDING_ATTACHMENT_UPLOADS_PER_USER,
  MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_PENDING_UPLOADS,
  MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
} from "@kan/shared";

import {
  getActiveImageUsage,
  getPendingUploadUsage,
  getPhysicalImageUsage,
  isValidOptimizedWorkspaceCanvasImage,
  lockEditableWorkspace,
  reclaimWorkspaceCanvasImagesTx,
  withReclaimedS3Keys,
  WORKSPACE_CANVAS_UPLOAD_OUTBOX_GRACE_MS,
} from "./workspaceCanvasImage.internal";

export const createUploadSession = async (
  db: dbClient,
  input: {
    publicId: string;
    workspacePublicId: string;
    userId: string;
    s3Key: string;
    filename: string;
    originalFilename: string;
    contentType: string;
    size: number;
    sha256: string;
    expiresAt: Date;
  },
) =>
  db.transaction(async (tx) => {
    const boundary = await lockEditableWorkspace(
      tx,
      input.workspacePublicId,
      input.userId,
    );
    if (boundary.status !== "locked") return boundary;
    const now = new Date();
    const reclaimedS3Keys = await reclaimWorkspaceCanvasImagesTx(tx, {
      workspaceId: boundary.workspace.id,
      now,
    });
    const physicalUsage = await getPhysicalImageUsage(
      tx,
      boundary.workspace.id,
      now,
    );
    if (physicalUsage.totalBytes >= MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES) {
      return withReclaimedS3Keys(
        { status: "storage_budget" as const },
        reclaimedS3Keys,
      );
    }
    const usage = await getActiveImageUsage(tx, boundary.workspace.id);
    if (!hasWorkspaceCanvasActiveCapacity(usage.totalBytes, 0)) {
      return withReclaimedS3Keys(
        { status: "image_budget" as const },
        reclaimedS3Keys,
      );
    }
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .for("update");
    if (!user) {
      return withReclaimedS3Keys(
        { status: "user_missing" as const },
        reclaimedS3Keys,
      );
    }
    const [pendingForUser] = await tx
      .select({ count: count() })
      .from(workspaceCanvasImageUploadSessions)
      .where(
        and(
          eq(workspaceCanvasImageUploadSessions.userId, input.userId),
          isNull(workspaceCanvasImageUploadSessions.consumedAt),
          gt(workspaceCanvasImageUploadSessions.expiresAt, now),
        ),
      );
    if (
      (pendingForUser?.count ?? 0) >= MAX_PENDING_ATTACHMENT_UPLOADS_PER_USER
    ) {
      return withReclaimedS3Keys(
        { status: "user_limit" as const },
        reclaimedS3Keys,
      );
    }
    const pendingUsage = await getPendingUploadUsage(
      tx,
      boundary.workspace.id,
      now,
    );
    if (!hasWorkspaceCanvasPendingCapacity(pendingUsage, input.size)) {
      return withReclaimedS3Keys(
        {
          status:
            pendingUsage.count >= MAX_WORKSPACE_CANVAS_PENDING_UPLOADS
              ? ("workspace_limit" as const)
              : ("staging_budget" as const),
        },
        reclaimedS3Keys,
      );
    }
    const [session] = await tx
      .insert(workspaceCanvasImageUploadSessions)
      .values({
        publicId: input.publicId,
        workspaceId: boundary.workspace.id,
        userId: input.userId,
        s3Key: input.s3Key,
        filename: input.filename,
        originalFilename: input.originalFilename,
        contentType: input.contentType,
        size: input.size,
        sha256: input.sha256,
        expiresAt: input.expiresAt,
      })
      .returning({ publicId: workspaceCanvasImageUploadSessions.publicId });
    if (session) {
      await tx
        .insert(workspaceCanvasImageStorageDeletions)
        .values({
          s3Key: input.s3Key,
          workspaceId: boundary.workspace.id,
          size: input.size,
          availableAt: new Date(
            input.expiresAt.getTime() + WORKSPACE_CANVAS_UPLOAD_OUTBOX_GRACE_MS,
          ),
        })
        .onConflictDoNothing();
    }
    return session
      ? withReclaimedS3Keys(
          { status: "created" as const, session },
          reclaimedS3Keys,
        )
      : withReclaimedS3Keys({ status: "not_found" as const }, reclaimedS3Keys);
  });

export const claimUploadSession = async (
  db: dbClient,
  input: {
    publicId: string;
    workspacePublicId: string;
    userId: string;
    claimToken: string;
    claimExpiresAt: Date;
  },
) =>
  db.transaction(async (tx) => {
    const boundary = await lockEditableWorkspace(
      tx,
      input.workspacePublicId,
      input.userId,
    );
    if (boundary.status !== "locked") return boundary;
    const now = new Date();
    const [session] = await tx
      .update(workspaceCanvasImageUploadSessions)
      .set({
        claimToken: input.claimToken,
        claimExpiresAt: input.claimExpiresAt,
      })
      .where(
        and(
          eq(workspaceCanvasImageUploadSessions.publicId, input.publicId),
          eq(
            workspaceCanvasImageUploadSessions.workspaceId,
            boundary.workspace.id,
          ),
          eq(workspaceCanvasImageUploadSessions.userId, input.userId),
          isNull(workspaceCanvasImageUploadSessions.consumedAt),
          gt(workspaceCanvasImageUploadSessions.expiresAt, now),
          or(
            isNull(workspaceCanvasImageUploadSessions.claimToken),
            isNull(workspaceCanvasImageUploadSessions.claimExpiresAt),
            lte(workspaceCanvasImageUploadSessions.claimExpiresAt, now),
          ),
        ),
      )
      .returning();
    if (session) return { status: "claimed" as const, session };
    const [image] = await tx
      .select({
        publicId: workspaceCanvasImages.publicId,
        originalFilename: workspaceCanvasImages.originalFilename,
        contentType: workspaceCanvasImages.contentType,
        size: workspaceCanvasImages.size,
        width: workspaceCanvasImages.width,
        height: workspaceCanvasImages.height,
        optimizedAt: workspaceCanvasImages.optimizedAt,
        createdAt: workspaceCanvasImages.createdAt,
      })
      .from(workspaceCanvasImageUploadSessions)
      .innerJoin(
        workspaceCanvasImages,
        and(
          eq(
            workspaceCanvasImages.uploadSessionId,
            workspaceCanvasImageUploadSessions.id,
          ),
          eq(workspaceCanvasImages.workspaceId, boundary.workspace.id),
          isNull(workspaceCanvasImages.deletedAt),
        ),
      )
      .where(
        and(
          eq(workspaceCanvasImageUploadSessions.publicId, input.publicId),
          eq(workspaceCanvasImageUploadSessions.userId, input.userId),
          isNotNull(workspaceCanvasImageUploadSessions.consumedAt),
        ),
      )
      .limit(1);
    return image
      ? { status: "already_created" as const, image }
      : { status: "unavailable" as const };
  });

export const releaseUploadSessionClaim = async (
  db: dbClient,
  input: { publicId: string; claimToken: string },
) => {
  const [session] = await db
    .update(workspaceCanvasImageUploadSessions)
    .set({ claimToken: null, claimExpiresAt: null })
    .where(
      and(
        eq(workspaceCanvasImageUploadSessions.publicId, input.publicId),
        eq(workspaceCanvasImageUploadSessions.claimToken, input.claimToken),
        isNull(workspaceCanvasImageUploadSessions.consumedAt),
      ),
    )
    .returning({ publicId: workspaceCanvasImageUploadSessions.publicId });
  return session;
};

export const abandonClaimedUploadSession = async (
  db: dbClient,
  input: {
    publicId: string;
    workspacePublicId: string;
    userId: string;
    claimToken: string;
  },
) =>
  db.transaction(async (tx) => {
    const boundary = await lockEditableWorkspace(
      tx,
      input.workspacePublicId,
      input.userId,
    );
    if (boundary.status !== "locked") return null;
    const now = new Date();
    const [session] = await tx
      .select({
        id: workspaceCanvasImageUploadSessions.id,
        s3Key: workspaceCanvasImageUploadSessions.s3Key,
        size: workspaceCanvasImageUploadSessions.size,
      })
      .from(workspaceCanvasImageUploadSessions)
      .where(
        and(
          eq(workspaceCanvasImageUploadSessions.publicId, input.publicId),
          eq(
            workspaceCanvasImageUploadSessions.workspaceId,
            boundary.workspace.id,
          ),
          eq(workspaceCanvasImageUploadSessions.userId, input.userId),
          eq(workspaceCanvasImageUploadSessions.claimToken, input.claimToken),
          isNull(workspaceCanvasImageUploadSessions.consumedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!session) return null;
    const physicalUsage = await getPhysicalImageUsage(
      tx,
      boundary.workspace.id,
      now,
    );
    if (
      !hasWorkspaceCanvasPhysicalCapacity(
        physicalUsage.totalBytes,
        session.size,
      )
    ) {
      return { status: "retained" as const, s3Key: session.s3Key };
    }
    const [abandoned] = await tx
      .update(workspaceCanvasImageUploadSessions)
      .set({
        consumedAt: now,
        claimToken: null,
        claimExpiresAt: null,
      })
      .where(
        and(
          eq(workspaceCanvasImageUploadSessions.id, session.id),
          eq(workspaceCanvasImageUploadSessions.claimToken, input.claimToken),
          isNull(workspaceCanvasImageUploadSessions.consumedAt),
        ),
      )
      .returning({ s3Key: workspaceCanvasImageUploadSessions.s3Key });
    return abandoned
      ? { status: "abandoned" as const, s3Key: abandoned.s3Key }
      : null;
  });

export const reserveUploadFinalObject = async (
  db: dbClient,
  input: {
    sessionPublicId: string;
    workspacePublicId: string;
    userId: string;
    claimToken: string;
    finalS3Key: string;
    finalSize: number;
  },
) =>
  db.transaction(async (tx) => {
    const boundary = await lockEditableWorkspace(
      tx,
      input.workspacePublicId,
      input.userId,
    );
    if (boundary.status !== "locked") return boundary;
    const now = new Date();
    const [session] = await tx
      .select({
        id: workspaceCanvasImageUploadSessions.id,
        size: workspaceCanvasImageUploadSessions.size,
        claimExpiresAt: workspaceCanvasImageUploadSessions.claimExpiresAt,
      })
      .from(workspaceCanvasImageUploadSessions)
      .where(
        and(
          eq(
            workspaceCanvasImageUploadSessions.publicId,
            input.sessionPublicId,
          ),
          eq(
            workspaceCanvasImageUploadSessions.workspaceId,
            boundary.workspace.id,
          ),
          eq(workspaceCanvasImageUploadSessions.userId, input.userId),
          eq(workspaceCanvasImageUploadSessions.claimToken, input.claimToken),
          gt(workspaceCanvasImageUploadSessions.claimExpiresAt, now),
          isNull(workspaceCanvasImageUploadSessions.consumedAt),
          gt(workspaceCanvasImageUploadSessions.expiresAt, now),
        ),
      )
      .limit(1)
      .for("update");
    if (!session?.claimExpiresAt) return { status: "unavailable" as const };
    if (
      !/^\.objects\/[a-z0-9]{12}$/.test(input.finalS3Key) ||
      input.finalSize <= 0 ||
      input.finalSize > MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_BYTES
    ) {
      return { status: "invalid_optimized_image" as const };
    }
    const reclaimedS3Keys = await reclaimWorkspaceCanvasImagesTx(tx, {
      workspaceId: boundary.workspace.id,
      now,
    });
    const physicalUsage = await getPhysicalImageUsage(
      tx,
      boundary.workspace.id,
      now,
    );
    const reservedUsage =
      physicalUsage.totalBytes +
      getWorkspaceCanvasImageQuotaBytes(input.finalSize);
    if (!hasWorkspaceCanvasPhysicalCapacity(reservedUsage, session.size)) {
      return withReclaimedS3Keys(
        { status: "storage_budget" as const },
        reclaimedS3Keys,
      );
    }
    const activeUsage = await getActiveImageUsage(tx, boundary.workspace.id);
    if (
      !hasWorkspaceCanvasActiveCapacity(activeUsage.totalBytes, input.finalSize)
    ) {
      return withReclaimedS3Keys(
        { status: "image_budget" as const },
        reclaimedS3Keys,
      );
    }
    const [reservation] = await tx
      .insert(workspaceCanvasImageStorageDeletions)
      .values({
        s3Key: input.finalS3Key,
        workspaceId: boundary.workspace.id,
        size: input.finalSize,
        availableAt: session.claimExpiresAt,
      })
      .onConflictDoNothing()
      .returning({ s3Key: workspaceCanvasImageStorageDeletions.s3Key });
    return reservation
      ? withReclaimedS3Keys(
          { status: "reserved" as const, reservation },
          reclaimedS3Keys,
        )
      : withReclaimedS3Keys(
          { status: "unavailable" as const },
          reclaimedS3Keys,
        );
  });

export const deleteUnissuedUploadSession = async (
  db: dbClient,
  input: {
    publicId: string;
    workspacePublicId: string;
    userId: string;
  },
) =>
  db.transaction(async (tx) => {
    const boundary = await lockEditableWorkspace(
      tx,
      input.workspacePublicId,
      input.userId,
    );
    if (boundary.status !== "locked") return boundary;
    const now = new Date();
    const [session] = await tx
      .update(workspaceCanvasImageUploadSessions)
      .set({
        expiresAt: now,
        claimToken: null,
        claimExpiresAt: null,
      })
      .where(
        and(
          eq(workspaceCanvasImageUploadSessions.publicId, input.publicId),
          eq(
            workspaceCanvasImageUploadSessions.workspaceId,
            boundary.workspace.id,
          ),
          eq(workspaceCanvasImageUploadSessions.userId, input.userId),
          isNull(workspaceCanvasImageUploadSessions.consumedAt),
          isNull(workspaceCanvasImageUploadSessions.claimToken),
          isNull(workspaceCanvasImageUploadSessions.claimExpiresAt),
        ),
      )
      .returning({
        publicId: workspaceCanvasImageUploadSessions.publicId,
        s3Key: workspaceCanvasImageUploadSessions.s3Key,
      });
    if (session) {
      await tx
        .update(workspaceCanvasImageStorageDeletions)
        .set({ availableAt: now })
        .where(
          and(
            eq(workspaceCanvasImageStorageDeletions.s3Key, session.s3Key),
            isNull(workspaceCanvasImageStorageDeletions.completedAt),
          ),
        );
    }
    return session
      ? { status: "cleanup_requested" as const, s3Key: session.s3Key }
      : { status: "unavailable" as const };
  });

export const consumeUploadSession = async (
  db: dbClient,
  input: {
    sessionPublicId: string;
    workspacePublicId: string;
    userId: string;
    claimToken: string;
    finalS3Key: string;
    finalContentType: "image/webp";
    finalSize: number;
    finalSha256: string;
    width: number;
    height: number;
    optimizedAt: Date;
  },
) =>
  db.transaction(async (tx) => {
    const boundary = await lockEditableWorkspace(
      tx,
      input.workspacePublicId,
      input.userId,
    );
    if (boundary.status !== "locked") return boundary;
    const now = new Date();
    const [session] = await tx
      .select()
      .from(workspaceCanvasImageUploadSessions)
      .where(
        and(
          eq(
            workspaceCanvasImageUploadSessions.publicId,
            input.sessionPublicId,
          ),
          eq(
            workspaceCanvasImageUploadSessions.workspaceId,
            boundary.workspace.id,
          ),
          eq(workspaceCanvasImageUploadSessions.userId, input.userId),
          eq(workspaceCanvasImageUploadSessions.claimToken, input.claimToken),
          gt(workspaceCanvasImageUploadSessions.claimExpiresAt, now),
          isNull(workspaceCanvasImageUploadSessions.consumedAt),
          gt(workspaceCanvasImageUploadSessions.expiresAt, now),
        ),
      )
      .limit(1)
      .for("update");
    if (!session) return { status: "unavailable" as const };
    if (
      !/^\.objects\/[a-z0-9]{12}$/.test(input.finalS3Key) ||
      !isValidOptimizedWorkspaceCanvasImage({
        contentType: input.finalContentType,
        size: input.finalSize,
        sha256: input.finalSha256,
        width: input.width,
        height: input.height,
        optimizedAt: input.optimizedAt,
      })
    ) {
      return { status: "invalid_optimized_image" as const };
    }
    const [reservation] = await tx
      .select({ id: workspaceCanvasImageStorageDeletions.id })
      .from(workspaceCanvasImageStorageDeletions)
      .where(
        and(
          eq(workspaceCanvasImageStorageDeletions.s3Key, input.finalS3Key),
          eq(
            workspaceCanvasImageStorageDeletions.workspaceId,
            boundary.workspace.id,
          ),
          eq(workspaceCanvasImageStorageDeletions.size, input.finalSize),
          isNull(workspaceCanvasImageStorageDeletions.completedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!reservation) return { status: "invalid_optimized_image" as const };
    const reclaimedS3Keys = await reclaimWorkspaceCanvasImagesTx(tx, {
      workspaceId: boundary.workspace.id,
      now,
    });
    const physicalUsage = await getPhysicalImageUsage(
      tx,
      boundary.workspace.id,
      now,
    );
    if (
      !hasWorkspaceCanvasPhysicalCapacity(
        physicalUsage.totalBytes,
        session.size,
      )
    ) {
      return withReclaimedS3Keys(
        { status: "storage_budget" as const },
        reclaimedS3Keys,
      );
    }
    const usage = await getActiveImageUsage(tx, boundary.workspace.id);
    if (!hasWorkspaceCanvasActiveCapacity(usage.totalBytes, input.finalSize)) {
      return withReclaimedS3Keys(
        { status: "image_budget" as const },
        reclaimedS3Keys,
      );
    }
    const [consumed] = await tx
      .update(workspaceCanvasImageUploadSessions)
      .set({ consumedAt: now, claimToken: null, claimExpiresAt: null })
      .where(
        and(
          eq(workspaceCanvasImageUploadSessions.id, session.id),
          isNull(workspaceCanvasImageUploadSessions.consumedAt),
        ),
      )
      .returning();
    if (!consumed) {
      return withReclaimedS3Keys(
        { status: "unavailable" as const },
        reclaimedS3Keys,
      );
    }
    const imagePublicId = generateUID();
    const [image] = await tx
      .insert(workspaceCanvasImages)
      .values({
        publicId: imagePublicId,
        workspaceId: boundary.workspace.id,
        title: consumed.originalFilename,
        filename: consumed.filename,
        originalFilename: consumed.originalFilename,
        contentType: input.finalContentType,
        size: input.finalSize,
        width: input.width,
        height: input.height,
        optimizedAt: input.optimizedAt,
        s3Key: input.finalS3Key,
        sha256: input.finalSha256.toLowerCase(),
        uploadSessionId: consumed.id,
        createdBy: consumed.userId,
      })
      .returning({
        publicId: workspaceCanvasImages.publicId,
        originalFilename: workspaceCanvasImages.originalFilename,
        contentType: workspaceCanvasImages.contentType,
        size: workspaceCanvasImages.size,
        width: workspaceCanvasImages.width,
        height: workspaceCanvasImages.height,
        optimizedAt: workspaceCanvasImages.optimizedAt,
        createdAt: workspaceCanvasImages.createdAt,
      });
    if (image) {
      await tx
        .update(workspaceCanvasImageStorageDeletions)
        .set({ completedAt: now })
        .where(
          and(
            eq(workspaceCanvasImageStorageDeletions.s3Key, input.finalS3Key),
            isNull(workspaceCanvasImageStorageDeletions.completedAt),
          ),
        );
    }
    return image
      ? withReclaimedS3Keys(
          { status: "created" as const, image },
          reclaimedS3Keys,
        )
      : withReclaimedS3Keys(
          { status: "unavailable" as const },
          reclaimedS3Keys,
        );
  });
