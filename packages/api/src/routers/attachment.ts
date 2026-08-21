import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardAttachmentRepo from "@kan/db/repository/cardAttachment.repo";
import { createLogger } from "@kan/logger";
import {
  ATTACHMENT_UPLOAD_CLAIM_TTL_MS,
  ATTACHMENT_UPLOAD_TTL_MS,
  copyObject,
  deleteObject,
  generateUID,
  generateUploadUrl,
  hasDetectableActiveAttachmentContent,
  hasValidAttachmentSignature,
  inspectObject,
  isAllowedAttachmentContentType,
  isAttachmentFilenameContentTypeCompatible,
  isValidAttachmentSha256,
  MAX_ATTACHMENT_SIZE,
  normalizeAttachmentContentType,
  sanitizeAttachmentFilename,
} from "@kan/shared/utils";

import { attachmentConfirmResponseSchema } from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { deleteCardResource } from "../utils/card-resource-delete";
import { assertPermission } from "../utils/permissions";

const log = createLogger("attachment-router");
const publicIdSchema = z.string().regex(/^[a-z0-9]{12}$/);

const contentTypeSchema = z
  .string()
  .min(1)
  .max(100)
  .transform(normalizeAttachmentContentType)
  .refine(isAllowedAttachmentContentType, "Unsupported attachment type");

const uploadRequestSchema = z
  .object({
    cardPublicId: publicIdSchema,
    filename: z.string().min(1).max(255),
    contentType: contentTypeSchema,
    size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
    sha256: z
      .string()
      .length(64)
      .refine(isValidAttachmentSha256, "Invalid SHA-256 digest")
      .transform((value) => value.toLowerCase()),
    publicVisibilityAcknowledged: z.boolean().optional().default(false),
  })
  .refine(
    (input) =>
      isAttachmentFilenameContentTypeCompatible(
        input.filename,
        input.contentType,
      ),
    { message: "Filename extension does not match attachment type" },
  );

function hashesMatch(expected: string, actual: string): boolean {
  const expectedHash = Buffer.from(expected, "hex");
  const actualHash = Buffer.from(actual, "hex");
  return (
    expectedHash.length === actualHash.length &&
    timingSafeEqual(expectedHash, actualHash)
  );
}

export const attachmentRouter = createTRPCRouter({
  generateUploadUrl: protectedProcedure
    .meta({
      openapi: {
        summary: "Create an attachment upload session",
        method: "POST",
        path: "/cards/{cardPublicId}/attachments/upload-url",
        description:
          "Creates a single-use upload session and a presigned S3 upload URL",
        tags: ["Attachments"],
        protect: true,
      },
    })
    .input(uploadRequestSchema)
    .output(
      z.object({
        url: z.string(),
        uploadSessionPublicId: z.string(),
        expiresAt: z.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");

      const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
      if (!bucket)
        throw new TRPCError({
          message: "Attachments bucket not configured",
          code: "INTERNAL_SERVER_ERROR",
        });

      const uploadSessionPublicId = generateUID();
      const filename = sanitizeAttachmentFilename(input.filename);
      const s3Key = `.uploads/${uploadSessionPublicId}/${filename}`;
      const expiresAt = new Date(Date.now() + ATTACHMENT_UPLOAD_TTL_MS);

      const creation = await cardAttachmentRepo.createUploadSession(ctx.db, {
        publicId: uploadSessionPublicId,
        cardId: card.id,
        workspaceId: card.workspaceId,
        userId,
        s3Key,
        filename,
        originalFilename: input.filename,
        contentType: input.contentType,
        size: input.size,
        sha256: input.sha256,
        expiresAt,
        publicVisibilityAcknowledged: input.publicVisibilityAcknowledged,
      });

      if (
        creation.status === "user_limit" ||
        creation.status === "card_limit"
      ) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many pending attachment uploads",
        });
      }
      if (creation.status !== "created") {
        if (creation.status === "public_ack_required") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
          });
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "Card workspace changed while creating the upload",
        });
      }

      let url: string;
      try {
        url = await generateUploadUrl(
          bucket,
          s3Key,
          input.contentType,
          input.size,
          ATTACHMENT_UPLOAD_TTL_MS / 1000,
        );
      } catch (error) {
        try {
          await cardAttachmentRepo.deleteUnissuedUploadSession(ctx.db, {
            publicId: uploadSessionPublicId,
            cardId: card.id,
            workspaceId: card.workspaceId,
            userId,
          });
        } catch (cleanupError) {
          log.warn(
            { err: cleanupError, uploadSessionPublicId },
            "Failed to delete an unissued attachment upload session",
          );
        }
        throw error;
      }

      return { url, uploadSessionPublicId, expiresAt };
    }),
  confirm: protectedProcedure
    .meta({
      openapi: {
        summary: "Confirm an attachment upload",
        method: "POST",
        path: "/cards/{cardPublicId}/attachments/confirm",
        description:
          "Validates and consumes an attachment upload session exactly once",
        tags: ["Attachments"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicIdSchema,
        uploadSessionPublicId: publicIdSchema,
        publicVisibilityAcknowledged: z.boolean().optional().default(false),
      }),
    )
    .output(attachmentConfirmResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");

      const claimToken = generateUID();
      const claim = await cardAttachmentRepo.claimUploadSessionForConfirmation(
        ctx.db,
        {
          publicId: input.uploadSessionPublicId,
          cardId: card.id,
          workspaceId: card.workspaceId,
          userId,
          claimToken,
          claimExpiresAt: new Date(Date.now() + ATTACHMENT_UPLOAD_CLAIM_TTL_MS),
        },
      );

      if (claim.status === "already_created") return claim.attachment;
      if (claim.status !== "claimed")
        throw new TRPCError({
          message: "Attachment upload is unavailable or already processing",
          code: "CONFLICT",
        });
      const session = claim.session;

      const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
      const finalS3Key = `.objects/${generateUID()}`;
      let copied = false;
      let persisted = false;

      try {
        if (!bucket)
          throw new TRPCError({
            message: "Attachments bucket not configured",
            code: "INTERNAL_SERVER_ERROR",
          });

        const inspected = await inspectObject(bucket, session.s3Key);
        if (
          inspected.size !== session.size ||
          normalizeAttachmentContentType(inspected.contentType) !==
            session.contentType ||
          !hashesMatch(session.sha256, inspected.sha256) ||
          hasDetectableActiveAttachmentContent(inspected.prefix) ||
          !hasValidAttachmentSignature(session.contentType, inspected.prefix)
        ) {
          throw new TRPCError({
            message: "Uploaded attachment does not match its upload session",
            code: "BAD_REQUEST",
          });
        }

        await copyObject({
          bucket,
          sourceKey: session.s3Key,
          destinationKey: finalS3Key,
          sourceEtag: inspected.etag,
          contentType: session.contentType,
        });
        copied = true;

        const consumption =
          await cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(
            ctx.db,
            {
              sessionPublicId: session.publicId,
              cardId: card.id,
              workspaceId: card.workspaceId,
              userId,
              claimToken,
              finalS3Key,
              publicVisibilityAcknowledged: input.publicVisibilityAcknowledged,
            },
          );

        if (consumption.status !== "created") {
          if (consumption.status === "public_ack_required") {
            throw new TRPCError({
              message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
              code: "PRECONDITION_FAILED",
            });
          }
          throw new TRPCError({
            message: "Card workspace changed or upload claim expired",
            code: "CONFLICT",
          });
        }
        persisted = true;

        try {
          await deleteObject(bucket, session.s3Key);
        } catch (error) {
          log.warn(
            { err: error, uploadSessionPublicId: session.publicId },
            "Failed to delete confirmed attachment staging object",
          );
        }

        return consumption.attachment;
      } catch (error) {
        if (!persisted) {
          try {
            await cardAttachmentRepo.releaseUploadSessionClaim(ctx.db, {
              publicId: session.publicId,
              claimToken,
            });
          } catch (releaseError) {
            log.warn(
              { err: releaseError, uploadSessionPublicId: session.publicId },
              "Failed to release attachment upload claim",
            );
          }
          if (copied && bucket) {
            try {
              await deleteObject(bucket, finalS3Key);
            } catch (cleanupError) {
              log.warn(
                { err: cleanupError, uploadSessionPublicId: session.publicId },
                "Failed to clean up an unconfirmed attachment object",
              );
            }
          }
        }
        throw error;
      }
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete an attachment",
        method: "DELETE",
        path: "/attachments/{attachmentPublicId}",
        description: "Soft deletes an attachment",
        tags: ["Attachments"],
        protect: true,
      },
    })
    .input(z.object({ attachmentPublicId: publicIdSchema }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await deleteCardResource(ctx.db, {
        userId,
        resourcePublicId: input.attachmentPublicId,
        removeReferences: false,
      });
      return { success: true };
    }),
});
