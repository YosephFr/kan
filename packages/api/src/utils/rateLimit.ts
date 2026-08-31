import type { NextApiRequest, NextApiResponse } from "next";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";

import { getRedisClient } from "@kan/db/redis";
import { createLogger } from "@kan/logger";

const log = createLogger("rateLimit");

export interface RateLimitOptions {
  points?: number;
  duration?: number;
  identifier?: (req: NextApiRequest) => string | Promise<string>;
  pointsToConsume?:
    | number
    | ((req: NextApiRequest) => number | Promise<number>);
  errorMessage?: string;
}

const normalizeIpHeader = (value: string | undefined) => {
  const normalized = value?.trim();
  return normalized === "" ? undefined : normalized;
};

export const getRequestIpRateLimitIdentifier = (
  req: NextApiRequest,
): string => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const realIp = req.headers["x-real-ip"];
  const cfConnectingIp = req.headers["cf-connecting-ip"];

  const firstForwardedIp = normalizeIpHeader(
    typeof forwardedFor === "string" ? forwardedFor.split(",")[0] : undefined,
  );
  const normalizedRealIp = normalizeIpHeader(
    typeof realIp === "string" ? realIp : undefined,
  );
  const normalizedCfIp = normalizeIpHeader(
    typeof cfConnectingIp === "string" ? cfConnectingIp : undefined,
  );

  const ip =
    firstForwardedIp ??
    normalizedRealIp ??
    normalizedCfIp ??
    req.socket.remoteAddress ??
    "unknown";

  return ip;
};

const DEFAULT_OPTIONS = {
  points: 100,
  duration: 60,
  errorMessage: "Too many requests, please try again later.",
  identifier: getRequestIpRateLimitIdentifier,
} as const;

function createRateLimiter(options: RateLimitOptions = {}) {
  const redis = getRedisClient();
  const points = options.points ?? DEFAULT_OPTIONS.points;
  const duration = options.duration ?? DEFAULT_OPTIONS.duration;

  // Use Redis if available, otherwise fall back to in-memory storage
  if (redis) {
    log.debug("Using Redis for rate limiting");
    return new RateLimiterRedis({
      storeClient: redis,
      points,
      duration,
    });
  }

  log.debug("Redis unavailable, falling back to in-memory rate limiting");
  return new RateLimiterMemory({
    points,
    duration,
  });
}

export function withRateLimit(
  options: RateLimitOptions,
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
) {
  const rateLimiter = createRateLimiter(options);
  const identifier = options.identifier ?? DEFAULT_OPTIONS.identifier;
  const pointsToConsume = options.pointsToConsume ?? 1;
  const errorMessage = options.errorMessage ?? DEFAULT_OPTIONS.errorMessage;

  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      const id = await identifier(req);
      const key = `ratelimit_${id}`;
      const requestPoints =
        typeof pointsToConsume === "function"
          ? await pointsToConsume(req)
          : pointsToConsume;

      await rateLimiter.consume(key, Math.max(1, Math.floor(requestPoints)));

      return await handler(req, res);
    } catch (error) {
      // rate-limiter-flexible throws an error with msBeforeNext or remainingPoints
      // when limit is exceeded. Check for these properties directly.
      if (
        error &&
        typeof error === "object" &&
        ("msBeforeNext" in error || "remainingPoints" in error)
      ) {
        return res.status(429).json({
          message: errorMessage,
        });
      }

      return await handler(req, res);
    }
  };
}
