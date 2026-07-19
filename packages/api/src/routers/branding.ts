import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as instanceSettingsRepo from "@kan/db/repository/instanceSettings.repo";
import { generateWorkspaceLogoUrl } from "@kan/shared/utils";

import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import {
  assertInstanceAdmin,
  isInstanceAdminEmail,
} from "../utils/instanceAdmin";

const brandingSchema = z.object({
  brandName: z.string(),
  brandLogo: z.string().nullable(),
  loginTitle: z.string().nullable(),
  loginDescription: z.string().nullable(),
  canManage: z.boolean(),
});

const defaultBranding = {
  brandName: "kan.bn",
  brandLogo: null,
  loginTitle: null,
  loginDescription: null,
} as const;

export const brandingRouter = createTRPCRouter({
  get: publicProcedure
    .meta({
      openapi: {
        summary: "Get instance branding",
        method: "GET",
        path: "/branding",
        description: "Retrieves public branding for this Kan instance",
        tags: ["Branding"],
        protect: false,
      },
    })
    .input(z.void())
    .output(brandingSchema)
    .query(async ({ ctx }) => {
      const settings =
        (await instanceSettingsRepo.get(ctx.db)) ?? defaultBranding;

      return {
        ...settings,
        brandLogo: await generateWorkspaceLogoUrl(settings.brandLogo),
        canManage: isInstanceAdminEmail(ctx.user?.email),
      };
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update instance branding",
        method: "PUT",
        path: "/branding",
        description: "Updates branding for this Kan instance",
        tags: ["Branding"],
        protect: true,
      },
    })
    .input(
      z.object({
        brandName: z.string().trim().min(1).max(64),
        loginTitle: z.string().trim().min(1).max(120).nullable(),
        loginDescription: z.string().trim().min(1).max(280).nullable(),
      }),
    )
    .output(brandingSchema)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      assertInstanceAdmin(user.email);

      const current =
        (await instanceSettingsRepo.get(ctx.db)) ?? defaultBranding;
      const updated = await instanceSettingsRepo.upsert(ctx.db, {
        ...input,
        brandLogo: current.brandLogo,
        updatedBy: user.id,
      });

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to update instance branding",
        });
      }

      return {
        ...updated,
        brandLogo: await generateWorkspaceLogoUrl(updated.brandLogo),
        canManage: true,
      };
    }),
});
