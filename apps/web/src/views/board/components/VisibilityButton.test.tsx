import type { ReactNode } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import VisibilityButton from "./VisibilityButton";

const mocks = vi.hoisted(() => ({
  boardQuery: vi.fn(),
  boardUpdate: vi.fn(),
  invalidateBoard: vi.fn(),
}));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("~/components/Button", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/CheckboxDropdown", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/MakeBoardPublicDialog", () => ({
  MakeBoardPublicDialog: () => null,
}));

vi.mock("~/components/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/hooks/usePermissions", () => ({
  usePermissions: () => ({ canEditBoard: true }),
}));

vi.mock("~/providers/popup", () => ({
  usePopup: () => ({ showPopup: vi.fn() }),
}));

vi.mock("~/utils/board-navigation", () => ({
  isBoardPublicId: (value: string) => /^[a-z0-9]{12}$/.test(value),
}));

vi.mock("~/utils/card-workspace", () => ({
  isPublicVisibilityAcknowledgementError: () => false,
}));

vi.mock("~/utils/resource-summary", () => ({
  getBoardResourceCount: () => 0,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      board: { byId: { invalidate: mocks.invalidateBoard } },
    }),
    board: {
      byId: { useQuery: mocks.boardQuery },
      update: { useMutation: mocks.boardUpdate },
    },
  },
}));

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boardQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  });
  mocks.boardUpdate.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  });
});

describe("VisibilityButton", () => {
  it("disables the resource query while the board public ID is empty", () => {
    renderToStaticMarkup(
      <VisibilityButton
        visibility="private"
        boardPublicId=""
        boardSlug=""
        queryParams={{
          boardPublicId: "",
          members: [],
          labels: [],
          lists: [],
        }}
        isLoading
        isAdmin
      />,
    );

    expect(mocks.boardQuery).toHaveBeenCalledOnce();
    expect(mocks.boardQuery).toHaveBeenCalledWith(
      { boardPublicId: "", members: [], labels: [], lists: [] },
      { enabled: false },
    );
  });
});
