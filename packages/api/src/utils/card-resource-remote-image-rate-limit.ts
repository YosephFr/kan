import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";

import { getRedisClient } from "@kan/db/redis";

interface RemoteImageRateLimiter {
  consume: (key: string) => Promise<unknown>;
}

export const REMOTE_IMAGE_RATE_LIMIT = {
  points: 10,
  durationSeconds: 60,
} as const;

export class RemoteImageRateLimitError extends Error {
  readonly code: "LIMIT_EXCEEDED" | "UNAVAILABLE";

  constructor(code: "LIMIT_EXCEEDED" | "UNAVAILABLE") {
    super(code);
    this.name = "RemoteImageRateLimitError";
    this.code = code;
  }
}

const isLimitRejection = (error: unknown) =>
  error !== null &&
  typeof error === "object" &&
  ("msBeforeNext" in error || "remainingPoints" in error);

export const createRemoteImageRateLimitConsumer =
  (limiter: RemoteImageRateLimiter) =>
  async (userId: string, cardPublicId: string) => {
    try {
      await limiter.consume(`${userId}:${cardPublicId}`);
    } catch (error) {
      throw new RemoteImageRateLimitError(
        isLimitRejection(error) ? "LIMIT_EXCEEDED" : "UNAVAILABLE",
      );
    }
  };

const createDefaultLimiter = (): RemoteImageRateLimiter => {
  const redis = getRedisClient();
  if (redis) {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "kan:card-resource:remote-image",
      points: REMOTE_IMAGE_RATE_LIMIT.points,
      duration: REMOTE_IMAGE_RATE_LIMIT.durationSeconds,
    });
  }
  return new RateLimiterMemory({
    points: REMOTE_IMAGE_RATE_LIMIT.points,
    duration: REMOTE_IMAGE_RATE_LIMIT.durationSeconds,
  });
};

let defaultConsumer:
  | ReturnType<typeof createRemoteImageRateLimitConsumer>
  | undefined;

export const consumeRemoteImageImportRateLimit = (
  userId: string,
  cardPublicId: string,
) => {
  defaultConsumer ??= createRemoteImageRateLimitConsumer(
    createDefaultLimiter(),
  );
  return defaultConsumer(userId, cardPublicId);
};
