import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_CARD_CANVAS_IMAGE_BYTES } from "@kan/shared";

import type { UploadCardResource } from "./card-resource-types";
import {
  hydrateCardCanvasImage,
  hydrateCardCanvasImages,
  parseCardCanvasImageDimensions,
} from "./card-canvas-resources";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn(),
}));

const makePngHeader = (width: number, height: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const makeResource = (publicId: string, size: number): UploadCardResource => ({
  kind: "upload",
  publicId,
  title: `${publicId}.png`,
  originalFilename: `${publicId}.png`,
  contentType: "image/png",
  size,
  viewUrl: `/api/attachments/${publicId}/view`,
  downloadUrl: `/api/attachments/${publicId}/download`,
  createdAt: new Date(0),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("card canvas image resources", () => {
  it("parses dimensions without decoding the image", () => {
    expect(
      parseCardCanvasImageDimensions("image/png", makePngHeader(640, 480)),
    ).toEqual({ width: 640, height: 480 });
  });

  it("rejects unsafe dimensions before decoding", async () => {
    const header = makePngHeader(8192, 8192);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Blob([header], { type: "image/png" }), {
            status: 200,
            headers: { "content-length": String(header.byteLength) },
          }),
        ),
      ),
    );
    const api = { getFiles: () => ({}) } as unknown as ExcalidrawImperativeAPI;

    await expect(
      hydrateCardCanvasImage(
        api,
        makeResource("resource0001", header.byteLength),
      ),
    ).rejects.toThrow("IMAGE_RESOURCE_DIMENSIONS_UNSAFE");
  });

  it("rejects an aggregate budget before fetching any image", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resources = [
      makeResource("resource0001", MAX_CARD_CANVAS_IMAGE_BYTES - 1),
      makeResource("resource0002", MAX_CARD_CANVAS_IMAGE_BYTES - 1),
      makeResource("resource0003", MAX_CARD_CANVAS_IMAGE_BYTES - 1),
    ];
    const api = {
      getSceneElements: () =>
        resources.map((resource) => ({
          id: resource.publicId,
          type: "image",
          customData: { kanResourcePublicId: resource.publicId },
        })),
    } as unknown as ExcalidrawImperativeAPI;

    await expect(hydrateCardCanvasImages(api, resources)).rejects.toThrow(
      "IMAGE_RESOURCE_BUDGET_EXCEEDED",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
