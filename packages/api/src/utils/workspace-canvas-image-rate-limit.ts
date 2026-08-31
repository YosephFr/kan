import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";

import { getRedisClient } from "@kan/db/redis";
import {
  MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
  MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
} from "@kan/shared";

interface WorkspaceCanvasImageRateLimiter {
  consume: (key: string) => Promise<unknown>;
}

export const WORKSPACE_CANVAS_IMAGE_RATE_LIMIT = {
  points: 10,
  durationSeconds: 60,
} as const;

export const WORKSPACE_CANVAS_IMAGE_VIEW_RATE_LIMIT = {
  points:
    MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES /
      MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES +
    400,
  durationSeconds: 60,
} as const;

export const WORKSPACE_CANVAS_IMAGE_UPLOAD_RATE_LIMIT = {
  points: 600,
  durationSeconds: 60,
} as const;

export class WorkspaceCanvasImageRateLimitError extends Error {
  readonly code: "LIMIT_EXCEEDED" | "UNAVAILABLE";

  constructor(code: "LIMIT_EXCEEDED" | "UNAVAILABLE") {
    super(code);
    this.name = "WorkspaceCanvasImageRateLimitError";
    this.code = code;
  }
}

const isLimitRejection = (error: unknown) =>
  error !== null &&
  typeof error === "object" &&
  ("msBeforeNext" in error || "remainingPoints" in error);

export const createWorkspaceCanvasImageRateLimitConsumer =
  (limiter: WorkspaceCanvasImageRateLimiter) =>
  async (userId: string, workspacePublicId: string) => {
    try {
      await limiter.consume(`${userId}:${workspacePublicId}`);
    } catch (error) {
      throw new WorkspaceCanvasImageRateLimitError(
        isLimitRejection(error) ? "LIMIT_EXCEEDED" : "UNAVAILABLE",
      );
    }
  };

const createDefaultLimiter = (): WorkspaceCanvasImageRateLimiter => {
  const redis = getRedisClient();
  if (redis) {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "kan:workspace-canvas:image",
      points: WORKSPACE_CANVAS_IMAGE_RATE_LIMIT.points,
      duration: WORKSPACE_CANVAS_IMAGE_RATE_LIMIT.durationSeconds,
    });
  }
  return new RateLimiterMemory({
    points: WORKSPACE_CANVAS_IMAGE_RATE_LIMIT.points,
    duration: WORKSPACE_CANVAS_IMAGE_RATE_LIMIT.durationSeconds,
  });
};

const createDefaultViewLimiter = (): WorkspaceCanvasImageRateLimiter => {
  const redis = getRedisClient();
  if (redis) {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "kan:workspace-canvas:image:view",
      points: WORKSPACE_CANVAS_IMAGE_VIEW_RATE_LIMIT.points,
      duration: WORKSPACE_CANVAS_IMAGE_VIEW_RATE_LIMIT.durationSeconds,
    });
  }
  return new RateLimiterMemory({
    points: WORKSPACE_CANVAS_IMAGE_VIEW_RATE_LIMIT.points,
    duration: WORKSPACE_CANVAS_IMAGE_VIEW_RATE_LIMIT.durationSeconds,
  });
};

const createDefaultUploadLimiter = (): WorkspaceCanvasImageRateLimiter => {
  const redis = getRedisClient();
  if (redis) {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "kan:workspace-canvas:image:upload",
      points: WORKSPACE_CANVAS_IMAGE_UPLOAD_RATE_LIMIT.points,
      duration: WORKSPACE_CANVAS_IMAGE_UPLOAD_RATE_LIMIT.durationSeconds,
    });
  }
  return new RateLimiterMemory({
    points: WORKSPACE_CANVAS_IMAGE_UPLOAD_RATE_LIMIT.points,
    duration: WORKSPACE_CANVAS_IMAGE_UPLOAD_RATE_LIMIT.durationSeconds,
  });
};

let defaultConsumer:
  | ReturnType<typeof createWorkspaceCanvasImageRateLimitConsumer>
  | undefined;
let defaultViewConsumer:
  | ReturnType<typeof createWorkspaceCanvasImageRateLimitConsumer>
  | undefined;
let defaultUploadConsumer:
  | ReturnType<typeof createWorkspaceCanvasImageRateLimitConsumer>
  | undefined;

export const consumeWorkspaceCanvasImageRateLimit = (
  userId: string,
  workspacePublicId: string,
) => {
  defaultConsumer ??= createWorkspaceCanvasImageRateLimitConsumer(
    createDefaultLimiter(),
  );
  return defaultConsumer(userId, workspacePublicId);
};

export const consumeWorkspaceCanvasImageViewRateLimit = (
  userId: string,
  workspacePublicId: string,
) => {
  defaultViewConsumer ??= createWorkspaceCanvasImageRateLimitConsumer(
    createDefaultViewLimiter(),
  );
  return defaultViewConsumer(userId, workspacePublicId);
};

export const consumeWorkspaceCanvasImageUploadRateLimit = (
  userId: string,
  workspacePublicId: string,
) => {
  defaultUploadConsumer ??= createWorkspaceCanvasImageRateLimitConsumer(
    createDefaultUploadLimiter(),
  );
  return defaultUploadConsumer(userId, workspacePublicId);
};
