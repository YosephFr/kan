import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";

import { getRedisClient } from "@kan/db/redis";

interface VisualWallCloneRateLimiter {
  consume: (key: string) => Promise<unknown>;
}

const VISUAL_WALL_CLONE_LEASE_MS = 60 * 60 * 1000;
const memoryLeases = new Map<string, { token: string; expiresAt: number }>();

export const VISUAL_WALL_CLONE_RATE_LIMIT = {
  points: 3,
  durationSeconds: 60,
} as const;

export class VisualWallCloneRateLimitError extends Error {
  readonly code: "LIMIT_EXCEEDED" | "UNAVAILABLE";

  constructor(code: "LIMIT_EXCEEDED" | "UNAVAILABLE") {
    super(code);
    this.name = "VisualWallCloneRateLimitError";
    this.code = code;
  }
}

export const getVisualWallCloneWorkspaceKey = (workspaceId: number) =>
  `workspace:${workspaceId}`;

const isLimitRejection = (error: unknown) =>
  error !== null &&
  typeof error === "object" &&
  ("msBeforeNext" in error || "remainingPoints" in error);

export const createVisualWallCloneRateLimitConsumer =
  (limiter: VisualWallCloneRateLimiter) =>
  async (userId: string, workspaceIdentifier: string) => {
    try {
      await limiter.consume(workspaceIdentifier);
    } catch (error) {
      throw new VisualWallCloneRateLimitError(
        isLimitRejection(error) ? "LIMIT_EXCEEDED" : "UNAVAILABLE",
      );
    }
  };

const createDefaultLimiter = (): VisualWallCloneRateLimiter => {
  const redis = getRedisClient();
  if (redis) {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "kan:visual-wall:clone",
      points: VISUAL_WALL_CLONE_RATE_LIMIT.points,
      duration: VISUAL_WALL_CLONE_RATE_LIMIT.durationSeconds,
    });
  }
  return new RateLimiterMemory({
    points: VISUAL_WALL_CLONE_RATE_LIMIT.points,
    duration: VISUAL_WALL_CLONE_RATE_LIMIT.durationSeconds,
  });
};

export const acquireVisualWallCloneLease = async (
  workspaceIdentifier: string,
) => {
  const key = `kan:visual-wall:clone:lease:${workspaceIdentifier}`;
  const token = crypto.randomUUID();
  const redis = getRedisClient();
  if (redis) {
    let acquired: "OK" | null;
    try {
      acquired = await redis.set(
        key,
        token,
        "PX",
        VISUAL_WALL_CLONE_LEASE_MS,
        "NX",
      );
    } catch {
      throw new VisualWallCloneRateLimitError("UNAVAILABLE");
    }
    if (acquired !== "OK") {
      throw new VisualWallCloneRateLimitError("LIMIT_EXCEEDED");
    }
    return async () => {
      await redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          token,
        )
        .catch(() => undefined);
    };
  }
  const now = Date.now();
  const existing = memoryLeases.get(key);
  if (existing && existing.expiresAt > now) {
    throw new VisualWallCloneRateLimitError("LIMIT_EXCEEDED");
  }
  memoryLeases.set(key, {
    token,
    expiresAt: now + VISUAL_WALL_CLONE_LEASE_MS,
  });
  return () => {
    if (memoryLeases.get(key)?.token === token) memoryLeases.delete(key);
    return Promise.resolve();
  };
};

let defaultConsumer:
  | ReturnType<typeof createVisualWallCloneRateLimitConsumer>
  | undefined;

export const consumeVisualWallCloneRateLimit = (
  userId: string,
  workspaceIdentifier: string,
) => {
  defaultConsumer ??= createVisualWallCloneRateLimitConsumer(
    createDefaultLimiter(),
  );
  return defaultConsumer(userId, workspaceIdentifier);
};
