import { afterEach, describe, expect, it, vi } from "vitest";

import {
  optimizeWorkspaceCanvasDisplayBlob,
  prepareWorkspaceCanvasLocalImage,
} from "./workspace-canvas-local-image";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn(),
}));

const makeJpeg = (width: number, height: number) => {
  const bytes = new Uint8Array(13);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return new File([bytes], "rotated.jpg", { type: "image/jpeg" });
};

afterEach(() => vi.unstubAllGlobals());

describe("workspace canvas local image", () => {
  it("uses the decoded orientation and keeps an alpha-capable canvas", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const getContext = vi.fn(() => ({ drawImage }));
    const canvas = {
      width: 0,
      height: 0,
      getContext,
      toBlob: (callback: BlobCallback, contentType: string) =>
        callback(new Blob([new Uint8Array([1])], { type: contentType })),
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() =>
        Promise.resolve({ width: 80, height: 120, close } as ImageBitmap),
      ),
    );
    vi.stubGlobal("document", {
      createElement: () => canvas,
    });

    const result = await prepareWorkspaceCanvasLocalImage(makeJpeg(120, 80));

    expect(result.sourceDimensions).toEqual({ width: 120, height: 80 });
    expect(result.displayDimensions).toEqual({ width: 80, height: 120 });
    expect(result.displayBlob.type).toBe("image/webp");
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 80, height: 120 }),
      0,
      0,
      80,
      120,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("serializes every display decode used by uploads and lazy hydration", async () => {
    const releases: (() => void)[] = [];
    let active = 0;
    let maximumActive = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        () =>
          new Promise<ImageBitmap>((resolve) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            releases.push(() =>
              resolve({
                width: 120,
                height: 80,
                close: () => {
                  active -= 1;
                },
              } as ImageBitmap),
            );
          }),
      ),
    );
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: BlobCallback, contentType: string) =>
          callback(new Blob([new Uint8Array([1])], { type: contentType })),
      }),
    });

    const source = makeJpeg(120, 80);
    const preparations = [1, 2, 3].map(() =>
      optimizeWorkspaceCanvasDisplayBlob(source),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await Promise.all(preparations);

    expect(maximumActive).toBe(1);
  });

  it("skips queued decodes after their workspace operation is aborted", async () => {
    let release: (() => void) | undefined;
    const createBitmap = vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          release = () =>
            resolve({
              width: 120,
              height: 80,
              close: vi.fn(),
            } as ImageBitmap);
        }),
    );
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: BlobCallback, contentType: string) =>
          callback(new Blob([new Uint8Array([1])], { type: contentType })),
      }),
    });
    const controller = new AbortController();
    const source = makeJpeg(120, 80);
    const queued = [1, 2, 3].map(() =>
      optimizeWorkspaceCanvasDisplayBlob(source, controller.signal),
    );
    await vi.waitFor(() => expect(createBitmap).toHaveBeenCalledOnce());

    controller.abort();
    release?.();
    const results = await Promise.allSettled(queued);

    expect(createBitmap).toHaveBeenCalledOnce();
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ name: "AbortError" });
      }
    }
  });
});
