import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardPipelineRepo from "@kan/db/repository/cardPipeline.repo";
import { colours } from "@kan/shared/constants";
import { stripHtml } from "@kan/shared/utils";

import { cardPipelineSchema } from "../schemas";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import {
  assertCardPipelineEditable,
  assertCardPipelineReadable,
  getCardMetaOrThrow,
  loadCardPipeline,
} from "../utils/card-pipeline";

const palette = new Set(colours.map((colour) => colour.code.toLowerCase()));
const colourCodeSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine((value) => palette.has(value), "Colour must use the Kan palette")
  .nullable();
const stageNameSchema = z
  .string()
  .max(255)
  .transform((value) => stripHtml(value).trim())
  .pipe(z.string().min(1).max(255));

export const cardPipelineRouter = createTRPCRouter({
  get: publicProcedure
    .meta({
      openapi: {
        summary: "Get a card subtask pipeline",
        method: "GET",
        path: "/cards/{cardPublicId}/pipeline",
        description:
          "Returns the pipeline without initializing it; anonymous access requires a public board",
        tags: ["Card pipeline"],
      },
    })
    .input(z.object({ cardPublicId: z.string().length(12) }))
    .output(cardPipelineSchema)
    .query(async ({ ctx, input }) => {
      const card = await getCardMetaOrThrow(ctx, input.cardPublicId);
      const requirePublic = await assertCardPipelineReadable(ctx, card);
      return loadCardPipeline(ctx, card, requirePublic);
    }),

  initialize: protectedProcedure
    .meta({
      openapi: {
        summary: "Initialize a card subtask pipeline",
        method: "POST",
        path: "/cards/{cardPublicId}/pipeline",
        description: "Creates the four fixed semantic stages idempotently",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: z.string().length(12) }))
    .output(cardPipelineSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await getCardMetaOrThrow(ctx, input.cardPublicId);
      await assertCardPipelineEditable(ctx, card);
      const result = await cardPipelineRepo.initialize(ctx.db, {
        cardPublicId: input.cardPublicId,
        expectedWorkspaceId: card.workspaceId,
        createdBy: userId,
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      if (result.status === "workspace_changed") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      if (result.status === "invalid_state") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "CARD_PIPELINE_INVALID_STATE",
        });
      }
      return loadCardPipeline(ctx, card);
    }),

  updateStages: protectedProcedure
    .meta({
      openapi: {
        summary: "Update the four card pipeline stages",
        method: "PUT",
        path: "/cards/{cardPublicId}/pipeline/stages",
        description:
          "Renames, colours and reorders stages without changing their fixed semantic statuses",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        stages: z
          .array(
            z
              .object({
                stagePublicId: z.string().length(12),
                name: stageNameSchema.optional(),
                colourCode: colourCodeSchema.optional(),
                index: z.number().int().min(0).max(3).optional(),
              })
              .refine(
                (stage) =>
                  stage.name !== undefined ||
                  stage.colourCode !== undefined ||
                  stage.index !== undefined,
                "At least one stage field must change",
              ),
          )
          .min(1)
          .max(4)
          .refine(
            (stages) =>
              new Set(stages.map((stage) => stage.stagePublicId)).size ===
              stages.length,
            "Each stage can only be updated once",
          ),
      }),
    )
    .output(cardPipelineSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await getCardMetaOrThrow(ctx, input.cardPublicId);
      await assertCardPipelineEditable(ctx, card);
      const result = await cardPipelineRepo.updateStages(ctx.db, {
        cardPublicId: input.cardPublicId,
        expectedWorkspaceId: card.workspaceId,
        stages: input.stages.map(({ stagePublicId, ...stage }) => ({
          publicId: stagePublicId,
          ...stage,
        })),
        updatedBy: userId,
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      if (result.status === "workspace_changed") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      if (result.status === "not_initialized") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "CARD_PIPELINE_NOT_INITIALIZED",
        });
      }
      if (result.status === "invalid_state") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "CARD_PIPELINE_INVALID_STATE",
        });
      }
      if (result.status === "invalid_input") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid pipeline stage set",
        });
      }
      return loadCardPipeline(ctx, card);
    }),
});
