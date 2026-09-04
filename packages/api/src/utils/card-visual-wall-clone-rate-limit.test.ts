import { RateLimiterMemory } from "rate-limiter-flexible";
import { describe, expect, it, vi } from "vitest";

import {
  acquireVisualWallCloneLease,
  createVisualWallCloneRateLimitConsumer,
  getVisualWallCloneWorkspaceKey,
  VISUAL_WALL_CLONE_RATE_LIMIT,
  VisualWallCloneRateLimitError,
} from "./card-visual-wall-clone-rate-limit";

describe("visual wall clone rate limit", () => {
  it("keys the limit by the canonical workspace identifier", async () => {
    const limiter = { consume: vi.fn(() => Promise.resolve()) };
    const consume = createVisualWallCloneRateLimitConsumer(limiter);
    const cardCloneKey = getVisualWallCloneWorkspaceKey(41);
    const boardCloneKey = getVisualWallCloneWorkspaceKey(41);
    expect(cardCloneKey).toBe(boardCloneKey);
    await consume("user-1", cardCloneKey);
    expect(limiter.consume).toHaveBeenCalledWith("workspace:41");
  });

  it("allows only one storage clone operation per workspace", async () => {
    const release = await acquireVisualWallCloneLease("leaseworkspace1");
    await expect(
      acquireVisualWallCloneLease("leaseworkspace1"),
    ).rejects.toEqual(new VisualWallCloneRateLimitError("LIMIT_EXCEEDED"));
    const releaseOther = await acquireVisualWallCloneLease("leaseworkspace2");
    await release();
    await releaseOther();
    const releaseAgain = await acquireVisualWallCloneLease("leaseworkspace1");
    await releaseAgain();
  });

  it("allows three clone operations per minute and rejects the fourth", async () => {
    const consume = createVisualWallCloneRateLimitConsumer(
      new RateLimiterMemory({
        points: VISUAL_WALL_CLONE_RATE_LIMIT.points,
        duration: VISUAL_WALL_CLONE_RATE_LIMIT.durationSeconds,
      }),
    );
    await consume("user-1", "workspace001");
    await consume("user-1", "workspace001");
    await consume("user-1", "workspace001");
    await expect(consume("user-1", "workspace001")).rejects.toEqual(
      new VisualWallCloneRateLimitError("LIMIT_EXCEEDED"),
    );
    await expect(consume("user-1", "workspace002")).resolves.toBeUndefined();
  });

  it("fails closed when the limiter is unavailable", async () => {
    const consume = createVisualWallCloneRateLimitConsumer({
      consume: () => Promise.reject(new Error("unavailable")),
    });
    await expect(consume("user-1", "workspace001")).rejects.toEqual(
      new VisualWallCloneRateLimitError("UNAVAILABLE"),
    );
  });
});
