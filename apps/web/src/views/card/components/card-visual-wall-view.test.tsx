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

import {
  CardVisualWallView,
  getAppendPosition,
  roundWallPatch,
} from "./CardVisualWallView";

const mocks = vi.hoisted(() => ({
  wallQuery: vi.fn(),
  resourceQuery: vi.fn(),
  mutation: vi.fn(),
  useUtils: vi.fn(),
  showPopup: vi.fn(),
}));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("~/components/visual-wall/VisualWall", () => ({
  VisualWall: ({
    items,
    canEdit,
    freeformUrl,
  }: {
    items: unknown[];
    canEdit: boolean;
    freeformUrl: string | null;
  }) => (
    <div
      data-visual-wall="true"
      data-items={items.length}
      data-can-edit={String(canEdit)}
      data-freeform-url={freeformUrl ?? ""}
    />
  ),
}));

vi.mock("./CardVisualWallResourceDialog", () => ({
  CardVisualWallResourceDialog: ({
    children,
    resources,
  }: {
    children?: ReactNode;
    resources: unknown[];
  }) => (
    <div data-resource-dialog="true" data-resources={resources.length}>
      {children}
    </div>
  ),
}));

vi.mock("~/providers/popup", () => ({
  usePopup: () => ({ showPopup: mocks.showPopup }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: mocks.useUtils,
    cardVisualWall: {
      get: { useQuery: mocks.wallQuery },
      addResource: { useMutation: mocks.mutation },
      updateItem: { useMutation: mocks.mutation },
      removeItem: { useMutation: mocks.mutation },
      setFreeformLink: { useMutation: mocks.mutation },
    },
    cardResource: {
      list: { useQuery: mocks.resourceQuery },
      createUpload: { useMutation: mocks.mutation },
      confirmUpload: { useMutation: mocks.mutation },
    },
  },
}));

vi.mock("~/utils/cardInvalidation", () => ({
  invalidateCard: vi.fn(),
}));

vi.mock("~/utils/card-workspace", () => ({
  isPublicVisibilityAcknowledgementError: () => false,
}));

const wallData = {
  exists: true,
  version: 3,
  freeformUrl: "https://www.icloud.com/freeform/board01#PROJECT",
  updatedAt: new Date("2026-09-04T12:00:00.000Z"),
  viewModeEnabled: false,
  items: [
    {
      publicId: "wallitem0001",
      resourcePublicId: "resource0001",
      title: "Project preview",
      viewUrl: "/api/visual-wall-resources/resource0001",
      x: 24,
      y: 24,
      width: 352,
      height: 264,
      zIndex: 1,
    },
  ],
};

const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useUtils.mockReturnValue({
    board: { byId: { invalidate: vi.fn() } },
    cardResource: { list: { invalidate: vi.fn() } },
  });
  mocks.wallQuery.mockReturnValue({
    data: wallData,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mocks.resourceQuery.mockReturnValue({
    data: { resources: [] },
    isLoading: false,
  });
  mocks.mutation.mockImplementation(mutation);
});

describe("CardVisualWallView", () => {
  it("renders public wall images and the Freeform link read-only", () => {
    const markup = renderToStaticMarkup(
      <CardVisualWallView
        cardPublicId="cardpublic01"
        canEdit={false}
        isPublicBoard
      />,
    );

    expect(markup).toContain('data-visual-wall="true"');
    expect(markup).toContain('data-items="1"');
    expect(markup).toContain('data-can-edit="false"');
    expect(markup).toContain(
      'data-freeform-url="https://www.icloud.com/freeform/board01#PROJECT"',
    );
  });

  it("requires acknowledgement before exposing public-board mutations", () => {
    const markup = renderToStaticMarkup(
      <CardVisualWallView cardPublicId="cardpublic01" canEdit isPublicBoard />,
    );

    expect(markup).toContain("This board is public");
    expect(markup).toContain('data-can-edit="false"');
  });

  it("allows private-card editors to use wall controls", () => {
    const markup = renderToStaticMarkup(
      <CardVisualWallView
        cardPublicId="cardpublic01"
        canEdit
        isPublicBoard={false}
      />,
    );

    expect(markup).toContain('data-can-edit="true"');
    expect(markup).not.toContain("This board is public");
  });

  it("honours server-enforced read-only mode even when the card shell is editable", () => {
    mocks.wallQuery.mockReturnValue({
      data: { ...wallData, viewModeEnabled: true },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const markup = renderToStaticMarkup(
      <CardVisualWallView
        cardPublicId="cardpublic01"
        canEdit
        isPublicBoard={false}
      />,
    );

    expect(markup).toContain('data-can-edit="false"');
  });

  it("keeps an image resource selectable when it already has a wall instance", () => {
    mocks.resourceQuery.mockReturnValue({
      data: {
        resources: [
          {
            kind: "upload",
            publicId: "resource0001",
            title: "Project preview",
            originalFilename: "preview.webp",
            contentType: "image/webp",
            size: 12_000,
            viewUrl: "/api/attachments/resource0001/view",
            downloadUrl: "/api/attachments/resource0001/download",
            createdAt: new Date("2026-09-04T12:00:00.000Z"),
          },
        ],
      },
      isLoading: false,
    });

    const markup = renderToStaticMarkup(
      <CardVisualWallView
        cardPublicId="cardpublic01"
        canEdit
        isPublicBoard={false}
      />,
    );

    expect(markup).toContain('data-resources="1"');
  });
});

describe("roundWallPatch", () => {
  it("normalises pointer coordinates before integer API mutations", () => {
    expect(
      roundWallPatch({
        x: 12.6,
        y: 44.2,
        width: 351.5,
        height: 263.6,
        zIndex: 4.8,
      }),
    ).toEqual({ x: 13, y: 44, width: 352, height: 264, zIndex: 5 });
  });
});

describe("getAppendPosition", () => {
  it("keeps panoramic images inside the API placement bounds", () => {
    const position = getAppendPosition([], 0, [40]);

    expect(position.height).toBe(44);
    expect(position.zIndex).toBe(1);
    expect(position.x + position.width).toBeLessThanOrEqual(1_200);
    expect(position.y + position.height).toBeLessThanOrEqual(1_000_000);
  });

  it("assigns each appended image a distinct layer above existing items", () => {
    expect(getAppendPosition(wallData.items, 0, [4 / 3]).zIndex).toBe(2);
    expect(getAppendPosition(wallData.items, 1, [4 / 3, 4 / 3]).zIndex).toBe(3);
  });
});
