import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { createLogger } from "@kan/logger";

import { createNextApiContext } from "../trpc";

const log = createLogger("api");

const isCloud = process.env.NEXT_PUBLIC_KAN_ENV === "cloud";

export function withApiLogging(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  options: { sensitive?: boolean } = {},
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const start = Date.now();
    const requestId = randomUUID();
    const route = req.url?.split("?")[0] ?? "unknown";
    const sensitive = options.sensitive === true;
    const input: Record<string, unknown> = {};
    if (!sensitive) {
      if (Object.keys(req.query).length > 0) input.query = req.query;
      const body = req.body as unknown;
      if (
        body !== null &&
        typeof body === "object" &&
        Object.keys(body).length > 0
      ) {
        input.body = body;
      }
    }

    let statusCode = 200;
    const originalStatus = res.status.bind(res);
    res.status = (code: number) => {
      statusCode = code;
      return originalStatus(code);
    };

    let userId: string | undefined;
    let email: string | undefined;
    if (!sensitive) {
      try {
        const ctx = await createNextApiContext(req);
        userId = ctx.user?.id;
        email = ctx.user?.email ?? undefined;
      } catch {
        // unauthenticated or auth unavailable
      }
    }

    let handlerError: unknown;
    try {
      await handler(req, res);
    } catch (err) {
      handlerError = err;
      statusCode = 500;
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }

    const duration = Date.now() - start;
    const meta = {
      requestId,
      procedure: route,
      transport: "rest",
      duration,
      ...(!sensitive && { userId }),
      ...(!sensitive && isCloud && email && { email }),
      ...(Object.keys(input).length > 0 && { input }),
      status: statusCode,
      ...(handlerError instanceof Error &&
        !sensitive && {
          error: handlerError.message,
          stack: handlerError.stack,
        }),
      ...(handlerError instanceof Error &&
        sensitive && { errorCode: "INTERNAL_SERVER_ERROR" }),
    };

    if (statusCode < 400) {
      log.info(meta, "API OK");
    } else {
      log.error(meta, "API error");
    }
  };
}
