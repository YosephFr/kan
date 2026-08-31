import type { NextApiRequest, NextApiResponse } from "next";
import cors from "nextjs-cors";
import { createOpenApiNextHandler } from "trpc-to-openapi";

import { appRouter } from "@kan/api";
import {
  createNextApiContext,
  createRESTContext,
  getSafeProcedureErrorMessage,
} from "@kan/api/trpc";
import {
  getRequestIpRateLimitIdentifier,
  withRateLimit,
} from "@kan/api/utils/rateLimit";

import { env } from "~/env";
import {
  createWorkspaceCanvasUploadRateLimitProfileResolver,
  WORKSPACE_CANVAS_UPLOAD_HTTP_RATE_LIMIT_POINTS,
} from "~/utils/workspace-canvas-upload-rate-limit";

const resolveRateLimitProfile =
  createWorkspaceCanvasUploadRateLimitProfileResolver({
    getVerifiedUserId: async (req) =>
      (await createNextApiContext(req)).user?.id,
    getIpIdentifier: getRequestIpRateLimitIdentifier,
  });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "6mb",
    },
  },
};

export default withRateLimit(
  {
    points: WORKSPACE_CANVAS_UPLOAD_HTTP_RATE_LIMIT_POINTS,
    duration: 60,
    identifier: async (req) => (await resolveRateLimitProfile(req)).identifier,
    pointsToConsume: async (req) =>
      (await resolveRateLimitProfile(req)).pointsToConsume,
  },
  async (req: NextApiRequest, res: NextApiResponse) => {
    await cors(req, res);

    const openApiHandler = createOpenApiNextHandler({
      router: appRouter,
      createContext: createRESTContext,
      onError:
        env.NODE_ENV === "development"
          ? ({ path, error }) => {
              console.error(
                `❌ REST failed on ${path ?? "<no-path>"}: ${getSafeProcedureErrorMessage(path, error)}`,
              );
            }
          : undefined,
    });

    return await openApiHandler(req, res);
  },
);
