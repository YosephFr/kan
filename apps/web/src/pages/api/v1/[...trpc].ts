import type { NextApiRequest, NextApiResponse } from "next";
import cors from "nextjs-cors";
import { createOpenApiNextHandler } from "trpc-to-openapi";

import { appRouter } from "@kan/api";
import { createRESTContext, getSafeProcedureErrorMessage } from "@kan/api/trpc";
import { withRateLimit } from "@kan/api/utils/rateLimit";

import { env } from "~/env";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "6mb",
    },
  },
};

export default withRateLimit(
  { points: 100, duration: 60 },
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
