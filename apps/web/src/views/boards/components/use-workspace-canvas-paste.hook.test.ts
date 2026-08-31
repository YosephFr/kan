import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceCanvasPaste } from "./use-workspace-canvas-paste";

interface HookEffect {
  cleanup?: () => void;
  deps?: readonly unknown[];
  next?: () => void | (() => void);
}

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as HookEffect[],
  stateCursor: 0,
  refCursor: 0,
  effectCursor: 0,
}));

const mocks = vi.hoisted(() => ({
  createUpload: vi.fn(),
  confirmUpload: vi.fn(),
  importRemoteImage: vi.fn(),
  deleteImage: vi.fn(),
  uploadFile: vi.fn(),
  addBlob: vi.fn(),
  hydrate: vi.fn(),
  insertBatch: vi.fn(),
  invalidate: vi.fn(),
  listImages: vi.fn(),
  normalizeClipboard: vi.fn(),
  sceneElements: [] as unknown[],
  showPopup: vi.fn(),
}));

const dependenciesChanged = (
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
) =>
  !previous ||
  !next ||
  previous.length !== next.length ||
  next.some((dependency, index) => !Object.is(dependency, previous[index]));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (message, segment, index) =>
        `${message}${segment}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("react", async (importOriginal) => {
  const actual: typeof React = await importOriginal();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.stateCursor++;
      if (!(index in hooks.states)) {
        hooks.states[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((current: T) => T)) => {
        hooks.states[index] =
          typeof next === "function"
            ? (next as (current: T) => T)(hooks.states[index] as T)
            : next;
      };
      return [hooks.states[index] as T, setState];
    },
    useRef<T>(initial: T) {
      const index = hooks.refCursor++;
      hooks.refs[index] ??= { current: initial };
      return hooks.refs[index] as { current: T };
    },
    useCallback<T extends (...args: never[]) => unknown>(callback: T) {
      return callback;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = hooks.effectCursor++;
      const previous = hooks.effects[index];
      hooks.effects[index] = {
        cleanup: previous?.cleanup,
        deps,
        next:
          !previous || dependenciesChanged(previous.deps, deps)
            ? effect
            : undefined,
      };
    },
  };
});

vi.mock("~/providers/popup", () => ({
  usePopup: () => ({ showPopup: mocks.showPopup }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      workspaceCanvas: {
        listImages: {
          fetch: mocks.listImages,
          invalidate: mocks.invalidate,
        },
      },
    }),
    workspaceCanvas: {
      createImageUpload: {
        useMutation: () => ({ mutateAsync: mocks.createUpload }),
      },
      confirmImageUpload: {
        useMutation: () => ({ mutateAsync: mocks.confirmUpload }),
      },
      importRemoteImage: {
        useMutation: () => ({ mutateAsync: mocks.importRemoteImage }),
      },
      deleteImage: {
        useMutation: () => ({ mutateAsync: mocks.deleteImage }),
      },
    },
  },
}));

vi.mock("~/views/card/components/card-canvas-clipboard", () => ({
  getCardCanvasClipboardInputFromDataTransfer: vi.fn(),
  isCardCanvasInternalClipboard: () => false,
  normalizeCardCanvasClipboard: mocks.normalizeClipboard,
  readCardCanvasClipboardItems: vi.fn(),
}));

vi.mock("~/views/card/components/card-canvas-clipboard-operation", () => ({
  consumeCardCanvasExternalPaste: vi.fn(),
}));

vi.mock("~/views/card/components/card-canvas-image-import", () => ({
  getCardCanvasImageFiles: vi.fn(),
  getCardCanvasNativePasteAction: () => "continue",
  hasCardCanvasImageDragItem: () => false,
}));

vi.mock("~/views/card/components/resource-upload-queue", () => ({
  hashResourceFile: () => Promise.resolve("a".repeat(64)),
  uploadResourceFile: mocks.uploadFile,
}));

vi.mock("./workspace-canvas-image-loader", () => ({
  addWorkspaceCanvasImageBlob: mocks.addBlob,
  hydrateWorkspaceCanvasImage: mocks.hydrate,
  runWorkspaceCanvasImageQueue: async ({
    items,
    worker,
    onSettled,
  }: {
    items: unknown[];
    worker: (item: unknown) => Promise<void>;
    onSettled?: (item: unknown, error?: unknown) => void;
  }) => {
    for (const item of items) {
      try {
        await worker(item);
        onSettled?.(item);
      } catch (error) {
        onSettled?.(item, error);
      }
    }
    return { completed: items, failed: [] };
  },
}));

vi.mock("./workspace-canvas-local-image", () => ({
  prepareWorkspaceCanvasLocalImage: () =>
    Promise.resolve({
      contentType: "image/png",
      displayBlob: new Blob([new Uint8Array([1])], { type: "image/webp" }),
      displayDimensions: { width: 100, height: 80 },
    }),
}));

vi.mock("./workspace-canvas-paste", () => ({
  makeWorkspaceCanvasFilePasteItems: (files: File[]) =>
    files.map((file) => ({ type: "image", source: "file", file })),
  toWorkspaceCanvasPasteText: (item: { text?: string; url?: string }) =>
    item.text ?? item.url ?? "",
}));

vi.mock("./workspace-canvas-paste-batch", () => ({
  insertWorkspaceCanvasPasteBatch: mocks.insertBatch,
}));

vi.mock("./workspace-canvas-vertical-track", () => ({
  constrainWorkspaceCanvasSelection: (elements: unknown) => ({ elements }),
}));

const WORKSPACE_PUBLIC_ID = "workspace001";
const resource = (publicId: string) => ({
  kind: "upload" as const,
  publicId,
  title: "goal.webp",
  originalFilename: "goal.png",
  contentType: "image/webp",
  size: 100,
  width: 100,
  height: 80,
  optimizedAt: new Date(0),
  viewUrl: `/api/workspace-canvas-images/${publicId}`,
  downloadUrl: `/api/workspace-canvas-images/${publicId}`,
  createdAt: new Date(0),
});

const file = (name: string) => ({ name, type: "image/png", size: 100 }) as File;

const canvasApi = {
  getSceneElements: () => mocks.sceneElements,
  getAppState: () => ({ editingTextElement: null }),
} as unknown as ExcalidrawImperativeAPI;

const beginRender = () => {
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  hooks.effectCursor = 0;
};

const flushEffects = () => {
  for (const effect of hooks.effects) {
    if (!effect.next) continue;
    effect.cleanup?.();
    const cleanup = effect.next();
    effect.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    effect.next = undefined;
  }
};

const useRenderedHook = () => {
  beginRender();
  return useWorkspaceCanvasPaste({
    workspacePublicId: WORKSPACE_PUBLIC_ID,
    knownUsageBytes: 0,
    quotaBytes: 100 * 1024 * 1024,
    canvasApi,
    canEdit: true,
    onImagesChanged: vi.fn(),
  });
};

beforeEach(() => {
  hooks.states.length = 0;
  hooks.refs.length = 0;
  hooks.effects.length = 0;
  vi.clearAllMocks();
  mocks.sceneElements = [];
  vi.stubGlobal("navigator", {
    onLine: true,
    clipboard: { readText: vi.fn().mockResolvedValue("clipboard") },
  });
  mocks.createUpload.mockResolvedValue({
    uploadSessionPublicId: "uploadsess01",
    url: "https://upload.test",
    expiresAt: new Date(Date.now() + 60_000),
  });
  mocks.uploadFile.mockResolvedValue(undefined);
  mocks.confirmUpload.mockResolvedValue(resource("image0000001"));
  mocks.importRemoteImage.mockResolvedValue(resource("image0000002"));
  mocks.addBlob.mockResolvedValue(undefined);
  mocks.hydrate.mockResolvedValue({ width: 100, height: 80 });
  mocks.deleteImage.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.listImages.mockResolvedValue({
    images: [],
    usageBytes: 0,
    quotaBytes: 100 * 1024 * 1024,
  });
  mocks.normalizeClipboard.mockReturnValue({
    items: [{ type: "text", text: "clipboard" }],
  });
});

afterEach(() => {
  for (const effect of hooks.effects) effect.cleanup?.();
  vi.unstubAllGlobals();
});

describe("useWorkspaceCanvasPaste cleanup", () => {
  it("retries deletion after a confirmed local image cannot hydrate", async () => {
    mocks.addBlob.mockRejectedValueOnce(new Error("decode failed"));
    mocks.deleteImage
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);
    const hook = useRenderedHook();
    flushEffects();

    hook.importFiles([file("broken.png")]);
    await vi.waitFor(() => expect(mocks.deleteImage).toHaveBeenCalledTimes(2));

    expect(mocks.insertBatch).not.toHaveBeenCalled();
    expect(mocks.confirmUpload).toHaveBeenCalledOnce();
  });

  it("does not upload a retry while the previous resource cannot be removed", async () => {
    mocks.addBlob.mockRejectedValue(new Error("decode failed"));
    mocks.deleteImage.mockRejectedValue(new Error("offline"));
    let hook = useRenderedHook();
    flushEffects();
    hook.importFiles([file("broken.png")]);
    await vi.waitFor(() => expect(mocks.deleteImage).toHaveBeenCalledTimes(2));

    hook = useRenderedHook();
    expect(hook.failedImageCount).toBe(1);
    hook.retryFailedImages();
    await vi.waitFor(() => expect(mocks.deleteImage).toHaveBeenCalledTimes(4));
    hook = useRenderedHook();

    expect(mocks.createUpload).toHaveBeenCalledOnce();
    expect(hook.failedImageCount).toBe(1);
  });

  it("inserts a successful sibling when another image needs cleanup", async () => {
    mocks.confirmUpload
      .mockResolvedValueOnce(resource("image0000003"))
      .mockResolvedValueOnce(resource("image0000004"));
    mocks.addBlob
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValueOnce(undefined);
    mocks.deleteImage.mockRejectedValue(new Error("offline"));
    const hook = useRenderedHook();
    flushEffects();

    hook.importFiles([file("broken.png"), file("healthy.png")]);
    await vi.waitFor(() => expect(mocks.insertBatch).toHaveBeenCalledOnce());

    expect(mocks.insertBatch.mock.calls[0]?.[0]).toMatchObject({
      items: [
        {
          kind: "resource",
          resource: { publicId: "image0000004" },
        },
      ],
    });
  });

  it("allows text paste while image cleanup is pending", async () => {
    mocks.addBlob.mockRejectedValue(new Error("decode failed"));
    mocks.deleteImage.mockRejectedValue(new Error("offline"));
    let hook = useRenderedHook();
    flushEffects();
    hook.importFiles([file("broken.png")]);
    await vi.waitFor(() => expect(mocks.deleteImage).toHaveBeenCalledTimes(2));

    hook = useRenderedHook();
    hook.pasteFromClipboard();
    await vi.waitFor(() => expect(mocks.insertBatch).toHaveBeenCalledOnce());

    expect(mocks.insertBatch.mock.calls[0]?.[0]).toMatchObject({
      items: [{ kind: "text", text: "clipboard" }],
    });
    expect(mocks.createUpload).toHaveBeenCalledOnce();
  });

  it("reports a real cleanup failure to the conflict flow", async () => {
    mocks.deleteImage.mockRejectedValue(new Error("offline"));
    const hook = useRenderedHook();
    flushEffects();

    await expect(hook.deleteUnusedImages(["image0000005"])).rejects.toThrow(
      "WORKSPACE_CANVAS_IMAGE_CLEANUP_PENDING",
    );
    expect(mocks.deleteImage).toHaveBeenCalledTimes(2);
  });

  it("reuses an uploaded session when optimization is temporarily busy", async () => {
    const source = file("busy.png");
    mocks.confirmUpload
      .mockRejectedValueOnce(
        new Error("WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_BUSY"),
      )
      .mockResolvedValueOnce(resource("image0000006"));
    let hook = useRenderedHook();
    flushEffects();

    hook.importFiles([source]);
    await vi.waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledOnce());

    hook = useRenderedHook();
    expect(hook.failedImageCount).toBe(1);
    hook.retryFailedImages();
    await vi.waitFor(() => expect(mocks.insertBatch).toHaveBeenCalledOnce());

    expect(mocks.createUpload).toHaveBeenCalledOnce();
    expect(mocks.uploadFile).toHaveBeenCalledOnce();
    expect(mocks.confirmUpload).toHaveBeenCalledTimes(2);
    expect(mocks.confirmUpload).toHaveBeenLastCalledWith({
      workspacePublicId: WORKSPACE_PUBLIC_ID,
      uploadSessionPublicId: "uploadsess01",
    });
  });

  it("keeps text at the element boundary when offline images are omitted", async () => {
    mocks.sceneElements = Array.from({ length: 4_999 });
    vi.stubGlobal("navigator", {
      onLine: false,
      clipboard: { readText: vi.fn().mockResolvedValue("clipboard") },
    });
    mocks.normalizeClipboard.mockReturnValue({
      items: [
        { type: "text", text: "kept offline" },
        { type: "image", source: "file", file: file("offline.png") },
      ],
    });
    const hook = useRenderedHook();
    flushEffects();

    hook.pasteFromClipboard();
    await vi.waitFor(() => expect(mocks.insertBatch).toHaveBeenCalledOnce());

    expect(mocks.insertBatch.mock.calls[0]?.[0]).toMatchObject({
      items: [{ kind: "text", text: "kept offline" }],
    });
    expect(mocks.createUpload).not.toHaveBeenCalled();
  });
});

describe("useWorkspaceCanvasPaste storage errors", () => {
  it("reports physical storage exhaustion without claiming the active quota is full", async () => {
    mocks.confirmUpload.mockRejectedValueOnce(
      new Error("WORKSPACE_CANVAS_IMAGE_STORAGE_LIMIT_REACHED"),
    );
    const hook = useRenderedHook();
    flushEffects();

    hook.importFiles([file("too-large-for-storage.png")]);
    await vi.waitFor(() => expect(mocks.showPopup).toHaveBeenCalledOnce());

    expect(mocks.showPopup).toHaveBeenCalledWith({
      header: "Image storage is full",
      message: "Remove some elements before pasting more content.",
      icon: "error",
    });
    expect(mocks.listImages).not.toHaveBeenCalled();
  });

  it("keeps the physical storage message when the operation rejects outside the image queue", async () => {
    mocks.insertBatch.mockImplementationOnce(() => {
      throw new Error("WORKSPACE_CANVAS_IMAGE_STORAGE_LIMIT_REACHED");
    });
    const hook = useRenderedHook();
    flushEffects();

    hook.pasteFromClipboard();
    await vi.waitFor(() => expect(mocks.showPopup).toHaveBeenCalledOnce());

    expect(mocks.showPopup).toHaveBeenCalledWith({
      header: "Image storage is full",
      message: "Remove some elements before pasting more content.",
      icon: "error",
    });
  });
});
