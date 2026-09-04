import { afterEach, describe, expect, it, vi } from "vitest";

import {
  followCardWorkspaceDeepLink,
  fromLocalDateTimeInput,
  getCardWorkspaceNavigationQuery,
  getCardWorkspaceQueryValue,
  getCardWorkspaceTargetView,
  getCardWorkspaceView,
  getNextTabIndex,
  isCardWorkspaceAligned,
  isOpenSubtasksConfirmationError,
  isPublicVisibilityAcknowledgementError,
  toLocalDateTimeInput,
} from "./card-workspace";

const createAnimationFrameHarness = () => {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  return {
    request: (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel: (id: number) => {
      callbacks.delete(id);
    },
    flush: () => {
      while (callbacks.size > 0) {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((callback) => callback(0));
      }
    },
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("getCardWorkspaceView", () => {
  it("accepts canonical Spanish direct-link views", () => {
    expect(getCardWorkspaceView("subtareas")).toBe("subtasks");
    expect(getCardWorkspaceView(["muro-visual"])).toBe("visualWall");
    expect(getCardWorkspaceQueryValue("files")).toBe("archivos");
  });

  it("keeps legacy whiteboard links compatible", () => {
    expect(getCardWorkspaceView(undefined, "subtasks")).toBe("subtasks");
    expect(getCardWorkspaceView(undefined, ["whiteboard"])).toBe("visualWall");
    expect(getCardWorkspaceView("pizarra")).toBe("visualWall");
  });

  it("falls back to summary for unknown values", () => {
    expect(getCardWorkspaceView("unknown")).toBe("summary");
    expect(getCardWorkspaceView(undefined)).toBe("summary");
  });
});

describe("getCardWorkspaceTargetView", () => {
  it("uses deep links as section targets before the legacy view", () => {
    expect(
      getCardWorkspaceTargetView({
        value: "archivos",
        subtask: "subtask0001",
        frame: "frame0000001",
        resource: "resource0001",
      }),
    ).toBe("subtasks");
    expect(
      getCardWorkspaceTargetView({
        value: "resumen",
        frame: "frame0000001",
        resource: "resource0001",
      }),
    ).toBe("visualWall");
    expect(
      getCardWorkspaceTargetView({
        legacyValue: "summary",
        resource: "resource0001",
      }),
    ).toBe("files");
  });

  it("returns null when the URL does not target a workspace section", () => {
    expect(getCardWorkspaceTargetView({})).toBeNull();
    expect(getCardWorkspaceTargetView({ value: "pizarra" })).toBe("visualWall");
  });
});

describe("followCardWorkspaceDeepLink", () => {
  it("repositions the target when content above it grows asynchronously", () => {
    const animationFrames = createAnimationFrameHarness();
    const listeners = new Map<string, EventListener>();
    const scrollIntoView = vi.fn();
    let resize: ResizeObserverCallback | undefined;

    vi.stubGlobal("window", {
      requestAnimationFrame: animationFrames.request,
      cancelAnimationFrame: animationFrames.cancel,
      addEventListener: (eventName: string, listener: EventListener) =>
        listeners.set(eventName, listener),
      removeEventListener: (eventName: string) => listeners.delete(eventName),
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );

    const stop = followCardWorkspaceDeepLink({
      container: {} as Element,
      target: { scrollIntoView },
    });

    animationFrames.flush();
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "start",
    });

    resize?.([], {} as ResizeObserver);
    animationFrames.flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "auto",
      block: "start",
    });

    listeners.get("wheel")?.({} as Event);
    resize?.([], {} as ResizeObserver);
    animationFrames.flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    stop();
  });
});

describe("getCardWorkspaceNavigationQuery", () => {
  it("keeps only the deep-link parameter for the target section", () => {
    const conflictingQuery = {
      view: "summary",
      vista: "resumen",
      subtask: "old-subtask",
      recurso: "old-resource",
      frame: "old-frame",
      filter: "mine",
    };

    expect(
      getCardWorkspaceNavigationQuery(conflictingQuery, "subtasks", {
        subtask: "next-subtask",
      }),
    ).toEqual({
      vista: "subtareas",
      subtask: "next-subtask",
      filter: "mine",
    });
    expect(
      getCardWorkspaceNavigationQuery(conflictingQuery, "visualWall"),
    ).toEqual({
      vista: "muro-visual",
      filter: "mine",
    });
    expect(
      getCardWorkspaceNavigationQuery(conflictingQuery, "files", {
        resource: "next-resource",
      }),
    ).toEqual({
      vista: "archivos",
      recurso: "next-resource",
      filter: "mine",
    });
  });
});

describe("getNextTabIndex", () => {
  it("wraps arrow navigation and supports Home and End", () => {
    expect(getNextTabIndex(3, 4, "ArrowRight")).toBe(0);
    expect(getNextTabIndex(0, 4, "ArrowLeft")).toBe(3);
    expect(getNextTabIndex(2, 4, "Home")).toBe(0);
    expect(getNextTabIndex(1, 4, "End")).toBe(3);
    expect(getNextTabIndex(1, 4, "Enter")).toBeNull();
  });
});

describe("local date-time conversion", () => {
  it("round-trips a valid local value", () => {
    const value = "2026-08-21T14:30";
    expect(toLocalDateTimeInput(fromLocalDateTimeInput(value))).toBe(value);
  });

  it("rejects an empty value", () => {
    expect(fromLocalDateTimeInput("")).toBeNull();
  });
});

describe("isCardWorkspaceAligned", () => {
  it("requires the active workspace to match the card workspace", () => {
    expect(isCardWorkspaceAligned("workspace-a", "workspace-a")).toBe(true);
    expect(isCardWorkspaceAligned("workspace-a", "workspace-b")).toBe(false);
    expect(isCardWorkspaceAligned("workspace-a", undefined)).toBe(false);
  });
});

describe("isOpenSubtasksConfirmationError", () => {
  it("recognises only the structured backend precondition", () => {
    expect(
      isOpenSubtasksConfirmationError({
        message: "OPEN_SUBTASKS_CONFIRMATION_REQUIRED",
        data: { code: "PRECONDITION_FAILED" },
      }),
    ).toBe(true);
    expect(
      isOpenSubtasksConfirmationError({
        message: "OPEN_SUBTASKS_CONFIRMATION_REQUIRED",
        data: { code: "BAD_REQUEST" },
      }),
    ).toBe(false);
  });
});

describe("isPublicVisibilityAcknowledgementError", () => {
  it("recognises only the structured backend precondition", () => {
    expect(
      isPublicVisibilityAcknowledgementError({
        message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
        data: { code: "PRECONDITION_FAILED" },
      }),
    ).toBe(true);
    expect(
      isPublicVisibilityAcknowledgementError({
        message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
        data: { code: "BAD_REQUEST" },
      }),
    ).toBe(false);
  });
});
