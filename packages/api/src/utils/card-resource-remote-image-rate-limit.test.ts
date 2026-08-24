import { RateLimiterMemory } from "rate-limiter-flexible";
import { describe, expect, it, vi } from "vitest";

import {
  createRemoteImageRateLimitConsumer,
  REMOTE_IMAGE_RATE_LIMIT,
  RemoteImageRateLimitError,
} from "./card-resource-remote-image-rate-limit";

describe("remote image import rate limit", () => {
  it("uses a user and card scoped key", async () => {
    const limiter = { consume: vi.fn(() => Promise.resolve()) };
    const consume = createRemoteImageRateLimitConsumer(limiter);

    await consume("user-1", "cardpublic01");

    expect(limiter.consume).toHaveBeenCalledWith("user-1:cardpublic01");
  });

  it("distinguishes an exhausted limit from storage failure", async () => {
    const exhausted = createRemoteImageRateLimitConsumer({
      consume: vi.fn(() =>
        Promise.reject(
          Object.assign(new Error("rate limit exceeded"), {
            msBeforeNext: 1000,
            remainingPoints: 0,
          }),
        ),
      ),
    });
    const unavailable = createRemoteImageRateLimitConsumer({
      consume: vi.fn(() => Promise.reject(new Error("redis unavailable"))),
    });

    await expect(exhausted("user-1", "cardpublic01")).rejects.toEqual(
      new RemoteImageRateLimitError("LIMIT_EXCEEDED"),
    );
    await expect(unavailable("user-1", "cardpublic01")).rejects.toEqual(
      new RemoteImageRateLimitError("UNAVAILABLE"),
    );
  });

  it("allows 10 imports per minute and rejects the eleventh for one user and card", async () => {
    const consume = createRemoteImageRateLimitConsumer(
      new RateLimiterMemory({
        points: REMOTE_IMAGE_RATE_LIMIT.points,
        duration: REMOTE_IMAGE_RATE_LIMIT.durationSeconds,
      }),
    );

    await Promise.all(
      Array.from({ length: 10 }, () => consume("user-1", "cardpublic01")),
    );
    await expect(consume("user-1", "cardpublic01")).rejects.toEqual(
      new RemoteImageRateLimitError("LIMIT_EXCEEDED"),
    );
    await expect(consume("user-1", "anothercard1")).resolves.toBeUndefined();
  });
});
