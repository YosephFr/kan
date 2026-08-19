import { describe, expect, it } from "vitest";

import {
  APP_HOME_PATH,
  buildBoardPath,
  buildPulseDetailPath,
  isBoardsPath,
  PRIMARY_NAVIGATION_ORDER,
  WORKSPACE_HOME_PATH,
} from "./navigation";

describe("application navigation", () => {
  it("opens the company dashboard first", () => {
    expect(APP_HOME_PATH).toBe("/pulse");
    expect(PRIMARY_NAVIGATION_ORDER.slice(0, 2)).toEqual([
      "dashboard",
      "boards",
    ]);
  });

  it("opens a selected workspace on its boards", () => {
    expect(WORKSPACE_HOME_PATH).toBe("/boards");
  });

  it("builds direct board links inside the boards section", () => {
    expect(buildBoardPath("op4hzeqntemf")).toBe("/boards/op4hzeqntemf");
  });

  it("recognises the board index and individual boards", () => {
    expect(isBoardsPath("/boards")).toBe(true);
    expect(isBoardsPath("/boards/op4hzeqntemf")).toBe(true);
    expect(isBoardsPath("/pulse")).toBe(false);
  });

  it("builds stable drill-down links for a company and employee metric", () => {
    expect(
      buildPulseDetailPath({
        metric: "advanced",
        period: "week",
        workspacePublicId: "workspace1234",
        memberPublicId: "memberchr123",
      }),
    ).toBe(
      "/pulse/details?metric=advanced&period=week&workspace=workspace1234&member=memberchr123",
    );
  });
});
