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

import type { VisualWallProps } from "../../../components/visual-wall/visual-wall-types";
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
  wallRender: vi.fn(),
  cancel: vi.fn(),
  setData: vi.fn(),
  invalidateCard: vi.fn(),
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

vi.mock("~/components/visual-wall/VisualWall", () => ({
  VisualWall: (props: VisualWallProps) => {
    mocks.wallRender(props);
    const { items, canEdit, freeformUrl } = props;
    return (
      <div
        data-visual-wall="true"
        data-items={items.length}
        data-can-edit={String(canEdit)}
        data-freeform-url={freeformUrl ?? ""}
      />
    );
  },
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
  invalidateCard: mocks.invalidateCard,
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
    board: { byId: { invalidate: mocks.invalidateBoard } },
    cardVisualWall: { get: { cancel: mocks.cancel, setData: mocks.setData } },
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
  it("acknowledges moves without refetching the wall, card, activities or board", async () => {
    let cached = { ...wallData, version: 0 };
    const refetch = vi.fn();
    const mutateAsync = vi.fn().mockResolvedValue({
      status: "saved",
      version: 1,
      updatedAt: new Date(),
    });
    mocks.wallQuery.mockReturnValue({
      data: cached,
      isLoading: false,
      isError: false,
      refetch,
    });
    mocks.mutation.mockReturnValue({ mutateAsync });
    mocks.setData.mockImplementation(
      (_input, update: (current: typeof cached) => typeof cached) => {
        cached = update(cached);
      },
    );
    renderToStaticMarkup(
      <CardVisualWallView
        cardPublicId="cardpublic01"
        canEdit
        isPublicBoard={false}
      />,
    );
    const props = mocks.wallRender.mock.calls[0]?.[0] as VisualWallProps;
    const patch = { x: 128, y: 64, width: 352, height: 264, zIndex: 2 };

    await props.onUpdate("wallitem0001", patch);

    expect(cached.version).toBe(1);
    expect(cached.items[0]).toEqual({ ...wallData.items[0], ...patch });
    expect(mocks.cancel).toHaveBeenCalledWith({ cardPublicId: "cardpublic01" });
    expect(refetch).not.toHaveBeenCalled();
    expect(mocks.invalidateCard).not.toHaveBeenCalled();
    expect(mocks.invalidateBoard).not.toHaveBeenCalled();
  });

  it("does not update the cache when the server rejects editing permission", async () => {
    mocks.mutation.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("FORBIDDEN")),
    });
    renderToStaticMarkup(
      <CardVisualWallView
        cardPublicId="cardpublic01"
        canEdit
        isPublicBoard={false}
      />,
    );
    const props = mocks.wallRender.mock.calls[0]?.[0] as VisualWallProps;

    await expect(
      props.onUpdate("wallitem0001", {
        x: 128,
        y: 64,
        width: 352,
        height: 264,
        zIndex: 2,
      }),
    ).rejects.toThrow("FORBIDDEN");

    expect(mocks.setData).not.toHaveBeenCalled();
    expect(mocks.showPopup).toHaveBeenCalled();
  });

  it("loads a conflict once and applies the retry without discarding remote images", async () => {
    let cached = { ...wallData, version: 0 };
    const originalItem = wallData.items[0];
    if (!originalItem) throw new Error("Missing wall fixture");
    const remoteItem = { ...originalItem, publicId: "wallitem0002", x: 480 };
    const refetch = vi.fn().mockImplementation(() => {
      cached = {
        ...wallData,
        version: 4,
        items: [...wallData.items, remoteItem],
      };
      return Promise.resolve({ data: cached });
    });
    const mutateAsync = vi
      .fn()
      .mockResolvedValueOnce({ status: "conflict", remoteVersion: 4 })
      .mockResolvedValueOnce({
        status: "saved",
        version: 5,
        updatedAt: new Date(),
      });
    mocks.wallQuery.mockReturnValue({
      data: cached,
      isLoading: false,
      isError: false,
      refetch,
    });
    mocks.mutation.mockReturnValue({ mutateAsync });
    mocks.setData.mockImplementation(
      (_input, update: (current: typeof cached) => typeof cached) => {
        cached = update(cached);
      },
    );
    renderToStaticMarkup(
      <CardVisualWallView
        cardPublicId="cardpublic01"
        canEdit
        isPublicBoard={false}
      />,
    );
    const props = mocks.wallRender.mock.calls[0]?.[0] as VisualWallProps;

    await props.onUpdate("wallitem0001", {
      x: 128,
      y: 64,
      width: 352,
      height: 264,
      zIndex: 2,
    });

    expect(
      mutateAsync.mock.calls.map(
        ([input]) => (input as { expectedVersion: number }).expectedVersion,
      ),
    ).toEqual([0, 4]);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(cached.version).toBe(5);
    expect(cached.items[1]).toEqual(remoteItem);
    expect(mocks.invalidateBoard).not.toHaveBeenCalled();
  });

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
  it("preserves the proportions of long screenshots when adding them", () => {
    const position = getAppendPosition([], 0, [0.1]);

    expect(position.width / position.height).toBeCloseTo(0.1, 3);
    expect(getAppendPosition([], 3, [0.1, 1, 1, 1]).y).toBeGreaterThan(
      position.y + position.height,
    );
  });
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
