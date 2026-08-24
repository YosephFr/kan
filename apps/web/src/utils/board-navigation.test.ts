import { describe, expect, it } from "vitest";

import {
  getBoardRoutePublicId,
  isBoardPublicId,
  keepCurrentBoardData,
} from "./board-navigation";

describe("board navigation", () => {
  it("accepts only complete public board IDs", () => {
    expect(isBoardPublicId("9vvd5b7irecs")).toBe(true);
    expect(isBoardPublicId("")).toBe(false);
    expect(isBoardPublicId("9vvd5b7irec")).toBe(false);
    expect(isBoardPublicId("9VVD5B7IRECS")).toBe(false);
  });

  it("reads the board ID from Pages Router query values", () => {
    expect(getBoardRoutePublicId("9vvd5b7irecs")).toBe("9vvd5b7irecs");
    expect(getBoardRoutePublicId(["9vvd5b7irecs"])).toBe("9vvd5b7irecs");
    expect(getBoardRoutePublicId(undefined)).toBeNull();
    expect(getBoardRoutePublicId([])).toBeNull();
  });

  it("never carries placeholder data into a different board", () => {
    const board = { publicId: "9vvd5b7irecs", name: "GERENCIA" };

    expect(keepCurrentBoardData(board, "9vvd5b7irecs")).toBe(board);
    expect(keepCurrentBoardData(board, "w677zp7xb2z8")).toBeUndefined();
    expect(keepCurrentBoardData(board, null)).toBeUndefined();
  });
});
