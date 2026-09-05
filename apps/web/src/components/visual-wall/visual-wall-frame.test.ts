import { describe, expect, it, vi } from "vitest";

import { createVisualWallFrame } from "./visual-wall-frame";

describe("visual wall pointer frames", () => {
  it("renders only the latest pointer position once per animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    const request = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const render = vi.fn();
    const frame = createVisualWallFrame(render, request, vi.fn());
    for (let x = 0; x < 240; x++) frame.schedule({ x, y: x * 2 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    callbacks[0]?.(16);
    expect(render).toHaveBeenCalledExactlyOnceWith({ x: 239, y: 478 });
    frame.schedule({ x: 240, y: 480 });
    expect(request).toHaveBeenCalledTimes(2);
    callbacks[1]?.(32);
    expect(render).toHaveBeenLastCalledWith({ x: 240, y: 480 });
  });

  it("cancels queued rendering on pointer release or workspace unmount", () => {
    const cancel = vi.fn();
    const render = vi.fn();
    const callbacks: FrameRequestCallback[] = [];
    const frame = createVisualWallFrame(
      render,
      (callback) => {
        callbacks.push(callback);
        return 7;
      },
      cancel,
    );
    frame.schedule({ x: 30 });
    frame.cancel();
    expect(cancel).toHaveBeenCalledWith(7);
    callbacks[0]?.(16);
    expect(render).not.toHaveBeenCalled();
    frame.schedule({ x: 40 });
    callbacks[1]?.(32);
    expect(render).toHaveBeenCalledExactlyOnceWith({ x: 40 });
  });
});
