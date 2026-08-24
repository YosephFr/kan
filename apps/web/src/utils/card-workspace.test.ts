import { describe, expect, it } from "vitest";

import {
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

describe("getCardWorkspaceView", () => {
  it("accepts canonical Spanish direct-link views", () => {
    expect(getCardWorkspaceView("subtareas")).toBe("subtasks");
    expect(getCardWorkspaceView(["pizarra"])).toBe("whiteboard");
    expect(getCardWorkspaceQueryValue("files")).toBe("archivos");
  });

  it("keeps legacy English links compatible", () => {
    expect(getCardWorkspaceView(undefined, "subtasks")).toBe("subtasks");
    expect(getCardWorkspaceView(undefined, ["whiteboard"])).toBe("whiteboard");
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
    ).toBe("whiteboard");
    expect(
      getCardWorkspaceTargetView({
        legacyValue: "summary",
        resource: "resource0001",
      }),
    ).toBe("files");
  });

  it("returns null when the URL does not target a workspace section", () => {
    expect(getCardWorkspaceTargetView({})).toBeNull();
    expect(getCardWorkspaceTargetView({ value: "pizarra" })).toBe("whiteboard");
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
      getCardWorkspaceNavigationQuery(conflictingQuery, "whiteboard", {
        frame: "next-frame",
      }),
    ).toEqual({
      vista: "pizarra",
      frame: "next-frame",
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
