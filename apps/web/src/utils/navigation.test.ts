import { describe, expect, it } from "vitest";

import {
  APP_HOME_PATH,
  buildBoardPath,
  isBoardsPath,
  PRIMARY_NAVIGATION_ORDER,
} from "./navigation";

describe("application navigation", () => {
  it("opens the company dashboard first", () => {
    expect(APP_HOME_PATH).toBe("/pulse");
    expect(PRIMARY_NAVIGATION_ORDER.slice(0, 2)).toEqual([
      "dashboard",
      "boards",
    ]);
  });

  it("builds direct board links inside the boards section", () => {
    expect(buildBoardPath("op4hzeqntemf")).toBe("/boards/op4hzeqntemf");
  });

  it("recognises the board index and individual boards", () => {
    expect(isBoardsPath("/boards")).toBe(true);
    expect(isBoardsPath("/boards/op4hzeqntemf")).toBe(true);
    expect(isBoardsPath("/pulse")).toBe(false);
  });
});
