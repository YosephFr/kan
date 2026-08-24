import type { ReactElement } from "react";
import React from "react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import BoardPage from "../../pages/boards/[...boardId]";

const mocks = vi.hoisted(() => ({
  boardId: undefined as string | string[] | undefined,
}));

vi.mock("next/router", () => ({
  useRouter: () => ({ query: { boardId: mocks.boardId } }),
}));

vi.mock("~/components/Dashboard", () => ({
  getDashboardLayout: vi.fn(),
}));

vi.mock("~/components/Popup", () => ({
  default: () => null,
}));

vi.mock("~/utils/board-navigation", () => ({
  getBoardRoutePublicId: (value: string | string[] | undefined) => {
    const candidate = Array.isArray(value) ? value[0] : value;
    return candidate && /^[a-z0-9]{12}$/.test(candidate) ? candidate : null;
  },
}));

vi.mock("~/views/board", () => ({
  default: () => null,
}));

const getBoardViewKey = () => {
  const renderPage = BoardPage as () => ReactElement<{
    children: ReactElement[];
  }>;
  const page = renderPage();

  return page.props.children[0]?.key;
};

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("BoardPage navigation boundary", () => {
  beforeEach(() => {
    mocks.boardId = undefined;
  });

  it("keys the board view by a validated route ID", () => {
    expect(getBoardViewKey()).toBe("loading");

    mocks.boardId = "9vvd5b7irecs";
    expect(getBoardViewKey()).toBe("9vvd5b7irecs");

    mocks.boardId = "w677zp7xb2z8";
    expect(getBoardViewKey()).toBe("w677zp7xb2z8");

    mocks.boardId = "invalid";
    expect(getBoardViewKey()).toBe("loading");
  });
});
