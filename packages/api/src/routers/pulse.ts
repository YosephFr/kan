import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as pulseRepo from "@kan/db/repository/pulse.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { generateWorkspaceLogoUrl } from "@kan/shared/utils";

import { buildPulseSummary } from "../pulse/metrics";
import {
  buildPortfolioDetail,
  buildPortfolioSummary,
} from "../pulse/portfolio-metrics";
import {
  pulsePortfolioDetailSchema,
  pulsePortfolioSummarySchema,
  pulseSummarySchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

const resolvePortfolioLogos = async (
  source: Awaited<ReturnType<typeof pulseRepo.getPortfolioSourceByUserId>>,
) => ({
  ...source,
  workspaces: await Promise.all(
    source.workspaces.map(async (workspace) => ({
      ...workspace,
      logo: await generateWorkspaceLogoUrl(workspace.logo),
    })),
  ),
});

export const pulseRouter = createTRPCRouter({
  portfolio: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/pulse/portfolio",
        summary: "Get company portfolio progress",
        description:
          "Returns movement, delivery, stagnation, and team contribution across every workspace accessible to the user",
        tags: ["Workspaces"],
        protect: true,
      },
    })
    .input(z.object({ period: z.enum(["week", "month"]) }))
    .output(pulsePortfolioSummarySchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });

      const source = await pulseRepo.getPortfolioSourceByUserId(ctx.db, userId);
      return buildPortfolioSummary(
        await resolvePortfolioLogos(source),
        input.period,
      );
    }),
  detail: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/pulse/details",
        summary: "Get the cards behind a portfolio metric",
        description:
          "Returns the accessible cards represented by a company or team progress statistic",
        tags: ["Workspaces"],
        protect: true,
      },
    })
    .input(
      z.object({
        metric: z.enum(["advanced", "delivered", "stalled", "open"]),
        period: z.enum(["week", "month"]),
        workspacePublicId: z.string().min(12).optional(),
        memberPublicId: z.string().min(12).optional(),
      }),
    )
    .output(pulsePortfolioDetailSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });

      const source = await resolvePortfolioLogos(
        await pulseRepo.getPortfolioSourceByUserId(ctx.db, userId),
      );
      const workspace = input.workspacePublicId
        ? source.workspaces.find(
            (item) => item.publicId === input.workspacePublicId,
          )
        : undefined;
      const member = input.memberPublicId
        ? source.members.find((item) => item.publicId === input.memberPublicId)
        : undefined;

      if (input.workspacePublicId && !workspace)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      if (
        input.memberPublicId &&
        (!member || (workspace && member.workspaceId !== workspace.id))
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace member not found",
        });

      return buildPortfolioDetail(source, input);
    }),
  summary: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/workspaces/{workspacePublicId}/pulse",
        summary: "Get workspace flow metrics",
        description:
          "Returns current flow health, throughput, workload, and attention signals for a workspace",
        tags: ["Workspaces"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().min(12),
        period: z.enum(["week", "month"]),
      }),
    )
    .output(pulseSummarySchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace || workspace.deletedAt)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
        });

      await assertPermission(ctx.db, userId, workspace.id, "workspace:view");

      const source = await pulseRepo.getSourceByWorkspaceId(
        ctx.db,
        workspace.id,
      );
      if (!source)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
        });

      return buildPulseSummary(source, input.period);
    }),
});
