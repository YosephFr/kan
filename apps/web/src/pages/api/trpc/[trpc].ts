import type { NextApiRequest, NextApiResponse } from "next";
import { createNextApiHandler } from "@trpc/server/adapters/next";

import { appRouter } from "@kan/api/root";
import {
  createNextApiContext,
  createTRPCContext,
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

const nextApiHandler = createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
  onError:
    env.NODE_ENV === "development"
      ? ({ path, error }) => {
          console.error(
            `❌ tRPC failed on ${path ?? "<no-path>"}: ${getSafeProcedureErrorMessage(path, error)}`,
          );
        }
      : undefined,
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
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const result = await nextApiHandler(req, res);
    return result;
  },
);
