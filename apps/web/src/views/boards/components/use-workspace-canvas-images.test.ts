import type {
  AppState,
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceCanvasImageResource } from "./workspace-canvas-image-loader";
import { useWorkspaceCanvasImages } from "./use-workspace-canvas-images";
import {
  createCanvasApi,
  createDeferred as deferred,
  createImageElement as imageElement,
  createMetadataResult as metadataResult,
  createImageResource as resource,
  workspaceOne as WORKSPACE_ONE,
  workspaceTwo as WORKSPACE_TWO,
} from "./use-workspace-canvas-images.test-utils";

interface HookEffect {
  cleanup?: () => void;
  deps?: readonly unknown[];
  next?: () => void | (() => void);
}

interface HookMemo {
  deps?: readonly unknown[];
  value: unknown;
}

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as HookEffect[],
  memos: [] as HookMemo[],
  stateCursor: 0,
  refCursor: 0,
  effectCursor: 0,
  memoCursor: 0,
}));

const mocks = vi.hoisted(() => ({
  listImages: vi.fn(),
  hydrate: vi.fn(),
}));

const dependenciesChanged = (
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
) =>
  !previous ||
  !next ||
  previous.length !== next.length ||
  next.some((dependency, index) => !Object.is(dependency, previous[index]));

vi.mock("react", async (importOriginal) => {
  const actual: typeof React = await importOriginal();
  const memoize = <T>(factory: () => T, deps?: readonly unknown[]) => {
    const index = hooks.memoCursor++;
    const previous = hooks.memos[index];
    if (!previous || dependenciesChanged(previous.deps, deps)) {
      hooks.memos[index] = { value: factory(), deps };
    }
    return hooks.memos[index]?.value as T;
  };
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
    useMemo: memoize,
    useCallback<T extends (...args: never[]) => unknown>(
      callback: T,
      deps?: readonly unknown[],
    ) {
      return memoize(() => callback, deps);
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

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      workspaceCanvas: { listImages: { fetch: mocks.listImages } },
    }),
  },
}));

vi.mock("./workspace-canvas-image-loader", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    hydrateWorkspaceCanvasImageWithMetadataRefresh: mocks.hydrate,
  };
});

const beginRender = () => {
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  hooks.effectCursor = 0;
  hooks.memoCursor = 0;
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

const settle = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

const RenderHook = ({
  workspacePublicId,
  imagePublicIds,
  canvasApi,
}: {
  workspacePublicId: string;
  imagePublicIds: readonly string[];
  canvasApi: ExcalidrawImperativeAPI;
}) => {
  beginRender();
  return useWorkspaceCanvasImages({
    workspacePublicId,
    imagePublicIds,
    canvasApi,
  });
};

const mockSuccessfulHydration = () => {
  mocks.hydrate.mockImplementation(
    ({
      api,
      resource: image,
    }: {
      api: ExcalidrawImperativeAPI;
      resource: WorkspaceCanvasImageResource;
    }) => {
      api.addFiles([
        {
          id: image.publicId as BinaryFileData["id"],
          dataURL: "data:image/webp;base64,AA==" as BinaryFileData["dataURL"],
          mimeType: "image/webp",
          created: 0,
        },
      ]);
      return Promise.resolve({
        dimensions: { width: 100, height: 80 },
        resource: image,
      });
    },
  );
};

beforeEach(() => {
  hooks.states.length = 0;
  hooks.refs.length = 0;
  hooks.effects.length = 0;
  hooks.memos.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  for (const effect of hooks.effects) effect.cleanup?.();
});

describe("useWorkspaceCanvasImages", () => {
  it("hydrates visible images before nearby images", async () => {
    const visible = "visible00001";
    const nearby = "nearby000001";
    const distant = "distant00001";
    const ids = [distant, nearby, visible];
    const canvas = createCanvasApi({
      elements: [
        imageElement(distant, 3_000),
        imageElement(nearby, 900),
        imageElement(visible, 100),
      ],
    });
    mocks.listImages.mockResolvedValue(
      metadataResult(ids.map((publicId) => resource(publicId))),
    );
    mockSuccessfulHydration();

    RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.hydrate).toHaveBeenCalledTimes(2));

    expect(
      mocks.hydrate.mock.calls.map(
        ([input]) =>
          (input as { resource: WorkspaceCanvasImageResource }).resource
            .publicId,
      ),
    ).toEqual([visible, nearby]);
  });

  it("limits hook hydration to three concurrent image requests", async () => {
    const ids = Array.from(
      { length: 8 },
      (_, index) => `image${String(index).padStart(7, "0")}`,
    );
    const canvas = createCanvasApi({
      elements: ids.map((publicId, index) =>
        imageElement(publicId, index * 20),
      ),
    });
    const pending: ReturnType<typeof deferred<void>>[] = [];
    let active = 0;
    let peak = 0;
    mocks.listImages.mockResolvedValue(
      metadataResult(ids.map((publicId) => resource(publicId))),
    );
    mocks.hydrate.mockImplementation(
      ({
        api,
        resource: image,
      }: {
        api: ExcalidrawImperativeAPI;
        resource: WorkspaceCanvasImageResource;
      }) => {
        active += 1;
        peak = Math.max(peak, active);
        const job = deferred<void>();
        pending.push(job);
        return job.promise.then(() => {
          active -= 1;
          api.addFiles([
            {
              id: image.publicId as BinaryFileData["id"],
              dataURL:
                "data:image/webp;base64,AA==" as BinaryFileData["dataURL"],
              mimeType: "image/webp",
              created: 0,
            },
          ]);
          return {
            dimensions: { width: 100, height: 80 },
            resource: image,
          };
        });
      },
    );

    let result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(active).toBe(3);
    result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    expect(result).toMatchObject({ total: 8, loaded: 0, isLoading: true });

    const first = pending.shift();
    if (!first) throw new Error("Expected a pending hydration");
    first.resolve();
    await settle();
    result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    expect(result).toMatchObject({ total: 8, loaded: 1, isLoading: true });

    while (mocks.hydrate.mock.calls.length < ids.length) {
      const next = pending.shift();
      if (!next) throw new Error("Expected a pending hydration");
      next.resolve();
      await settle();
    }
    for (const job of pending) job.resolve();
    await vi.waitFor(() => expect(active).toBe(0));
    expect(peak).toBe(3);
  });

  it("keeps metadata in flight while rapid panning hydrates only the latest viewport", async () => {
    const firstId = "viewport0001";
    const middleId = "viewport0002";
    const lastId = "viewport0003";
    const ids = [firstId, middleId, lastId];
    const elements = [
      imageElement(firstId, 100),
      imageElement(middleId, 3_000),
      imageElement(lastId, 6_000),
    ];
    const canvas = createCanvasApi({ elements });
    const firstMetadata = deferred<ReturnType<typeof metadataResult>>();
    mocks.listImages.mockImplementation(
      ({ imagePublicIds }: { imagePublicIds: string[] }) => {
        return firstMetadata.promise.then(() =>
          metadataResult(imagePublicIds.map((publicId) => resource(publicId))),
        );
      },
    );
    mockSuccessfulHydration();

    const result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.listImages).toHaveBeenCalledOnce());

    for (const scrollY of [-3_000, -6_000]) {
      result.updateViewport(elements, {
        width: 1_000,
        height: 800,
        scrollX: 0,
        scrollY,
        zoom: { value: 1 },
      } as AppState);
    }

    await settle();
    expect(mocks.listImages).toHaveBeenCalledOnce();
    const requestSignal = (
      mocks.listImages.mock.calls[0]?.[1] as
        | { trpc?: { signal?: AbortSignal } }
        | undefined
    )?.trpc?.signal;
    expect(requestSignal?.aborted).toBe(false);

    firstMetadata.resolve(metadataResult([]));
    await vi.waitFor(() => expect(canvas.files[lastId]).toBeDefined());

    expect(mocks.listImages).toHaveBeenCalledOnce();
    expect(canvas.files[firstId]).toBeUndefined();
    expect(canvas.files[middleId]).toBeUndefined();
  });

  it("hydrates a newly visible image from cached metadata", async () => {
    const firstId = "cachedview01";
    const lastId = "cachedview02";
    const ids = [firstId, lastId];
    const elements = [imageElement(firstId, 100), imageElement(lastId, 6_000)];
    const canvas = createCanvasApi({ elements });
    mocks.listImages.mockResolvedValue(
      metadataResult(ids.map((publicId) => resource(publicId))),
    );
    mockSuccessfulHydration();

    const result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(canvas.files[firstId]).toBeDefined());

    result.updateViewport(elements, {
      width: 1_000,
      height: 800,
      scrollX: 0,
      scrollY: -6_000,
      zoom: { value: 1 },
    } as AppState);
    await vi.waitFor(() => expect(canvas.files[lastId]).toBeDefined());

    expect(mocks.listImages).toHaveBeenCalledOnce();
  });

  it("cancels stale hydration when the workspace changes", async () => {
    const oldId = "oldimage0001";
    const newId = "newimage0001";
    const oldMetadata = deferred<ReturnType<typeof metadataResult>>();
    const oldCanvas = createCanvasApi({
      elements: [imageElement(oldId, 100)],
    });
    const newCanvas = createCanvasApi({
      elements: [imageElement(newId, 100)],
    });
    mocks.listImages.mockImplementation(
      ({ workspacePublicId }: { workspacePublicId: string }) =>
        workspacePublicId === WORKSPACE_ONE
          ? oldMetadata.promise
          : Promise.resolve(metadataResult([resource(newId)])),
    );
    mockSuccessfulHydration();

    RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: [oldId],
      canvasApi: oldCanvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.listImages).toHaveBeenCalledTimes(1));
    const oldRequestSignal = (
      mocks.listImages.mock.calls[0]?.[1] as
        | { trpc?: { signal?: AbortSignal } }
        | undefined
    )?.trpc?.signal;

    RenderHook({
      workspacePublicId: WORKSPACE_TWO,
      imagePublicIds: [newId],
      canvasApi: newCanvas.api,
    });
    flushEffects();
    expect(oldRequestSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(newCanvas.files[newId]).toBeDefined());
    oldMetadata.resolve(metadataResult([resource(oldId)]));
    await settle();

    expect(oldCanvas.files[oldId]).toBeUndefined();
    expect(
      mocks.hydrate.mock.calls.map(
        ([input]) =>
          (input as { resource: WorkspaceCanvasImageResource }).resource
            .publicId,
      ),
    ).toEqual([newId]);
  });

  it("ignores a delayed metadata refresh after the workspace changes", async () => {
    const oldId = "oldrefresh01";
    const newId = "newrefresh01";
    const oldRefresh = deferred<ReturnType<typeof metadataResult>>();
    const oldCanvas = createCanvasApi({
      elements: [imageElement(oldId, 100)],
    });
    const newCanvas = createCanvasApi({
      elements: [imageElement(newId, 100)],
    });
    let oldRequestCount = 0;
    mocks.listImages.mockImplementation(
      ({ workspacePublicId }: { workspacePublicId: string }) => {
        if (workspacePublicId === WORKSPACE_ONE) {
          oldRequestCount += 1;
          return oldRequestCount === 1
            ? Promise.resolve(metadataResult([resource(oldId)]))
            : oldRefresh.promise;
        }
        return Promise.resolve({
          ...metadataResult([resource(newId)]),
          usageBytes: 222,
        });
      },
    );
    mocks.hydrate.mockImplementation(
      async ({
        api,
        resource: image,
        refreshResource,
      }: {
        api: ExcalidrawImperativeAPI;
        resource: WorkspaceCanvasImageResource;
        refreshResource: () => Promise<
          WorkspaceCanvasImageResource | undefined
        >;
      }) => {
        if (image.publicId === oldId) {
          const refreshed = await refreshResource();
          if (!refreshed) throw new Error("stale refresh");
          return {
            dimensions: { width: 100, height: 80 },
            resource: refreshed,
          };
        }
        api.addFiles([
          {
            id: image.publicId as BinaryFileData["id"],
            dataURL: "data:image/webp;base64,AA==" as BinaryFileData["dataURL"],
            mimeType: "image/webp",
            created: 0,
          },
        ]);
        return {
          dimensions: { width: 100, height: 80 },
          resource: image,
        };
      },
    );

    RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: [oldId],
      canvasApi: oldCanvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.listImages).toHaveBeenCalledTimes(2));

    RenderHook({
      workspacePublicId: WORKSPACE_TWO,
      imagePublicIds: [newId],
      canvasApi: newCanvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(newCanvas.files[newId]).toBeDefined());

    let result = RenderHook({
      workspacePublicId: WORKSPACE_TWO,
      imagePublicIds: [newId],
      canvasApi: newCanvas.api,
    });
    expect(result.knownUsageBytes).toBe(222);

    oldRefresh.resolve({
      ...metadataResult([resource(oldId)]),
      usageBytes: 999,
    });
    await settle();

    result = RenderHook({
      workspacePublicId: WORKSPACE_TWO,
      imagePublicIds: [newId],
      canvasApi: newCanvas.api,
    });
    expect(result.knownUsageBytes).toBe(222);
    expect(oldCanvas.files[oldId]).toBeUndefined();
  });

  it("ignores a stale metadata failure after the workspace changes", async () => {
    const oldId = "oldfailed001";
    const newId = "newhealthy01";
    const oldMetadata = deferred<ReturnType<typeof metadataResult>>();
    const oldCanvas = createCanvasApi({
      elements: [imageElement(oldId, 100)],
    });
    const newCanvas = createCanvasApi({
      elements: [imageElement(newId, 100)],
    });
    mocks.listImages.mockImplementation(
      ({ workspacePublicId }: { workspacePublicId: string }) =>
        workspacePublicId === WORKSPACE_ONE
          ? oldMetadata.promise
          : Promise.resolve(metadataResult([resource(newId)])),
    );
    mockSuccessfulHydration();

    RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: [oldId],
      canvasApi: oldCanvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.listImages).toHaveBeenCalledTimes(1));

    RenderHook({
      workspacePublicId: WORKSPACE_TWO,
      imagePublicIds: [newId],
      canvasApi: newCanvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(newCanvas.files[newId]).toBeDefined());
    oldMetadata.reject(new Error("old workspace failed"));
    await settle();

    const result = RenderHook({
      workspacePublicId: WORKSPACE_TWO,
      imagePublicIds: [newId],
      canvasApi: newCanvas.api,
    });
    expect(result).toMatchObject({
      total: 1,
      loaded: 1,
      failed: 0,
      imageLoadError: false,
    });
  });

  it("does not rehydrate a newly uploaded local image", async () => {
    const publicId = "localimage01";
    const canvas = createCanvasApi({
      elements: [imageElement(publicId, 100)],
    });
    mocks.listImages.mockImplementation(
      ({ imagePublicIds }: { imagePublicIds: string[] }) =>
        Promise.resolve(
          metadataResult(
            imagePublicIds.includes(publicId) ? [resource(publicId)] : [],
          ),
        ),
    );

    RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: [],
      canvasApi: canvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.listImages).toHaveBeenCalledOnce());
    await settle();

    canvas.api.addFiles([
      {
        id: publicId as BinaryFileData["id"],
        dataURL: "data:image/webp;base64,bG9jYWw=" as BinaryFileData["dataURL"],
        mimeType: "image/webp",
        created: 0,
      },
    ]);
    RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: [publicId],
      canvasApi: canvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.listImages).toHaveBeenCalledTimes(2));
    await settle();

    expect(mocks.hydrate).not.toHaveBeenCalled();
  });

  it("reports one failed image and retries only that image", async () => {
    const goodId = "goodimage001";
    const badId = "badimage0001";
    const ids = [goodId, badId];
    const canvas = createCanvasApi({
      elements: ids.map((publicId, index) =>
        imageElement(publicId, index * 100),
      ),
    });
    mocks.listImages.mockResolvedValue(
      metadataResult(ids.map((publicId) => resource(publicId))),
    );
    let badAttempts = 0;
    mocks.hydrate.mockImplementation(
      ({
        api,
        resource: image,
      }: {
        api: ExcalidrawImperativeAPI;
        resource: WorkspaceCanvasImageResource;
      }) => {
        if (image.publicId === badId && badAttempts++ === 0) {
          return Promise.reject(new Error("broken image"));
        }
        api.addFiles([
          {
            id: image.publicId as BinaryFileData["id"],
            dataURL: "data:image/webp;base64,AA==" as BinaryFileData["dataURL"],
            mimeType: "image/webp",
            created: 0,
          },
        ]);
        return Promise.resolve({
          dimensions: { width: 100, height: 80 },
          resource: image,
        });
      },
    );

    let result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.hydrate).toHaveBeenCalledTimes(2));
    await settle();
    result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    expect(result).toMatchObject({
      total: 2,
      loaded: 1,
      failed: 1,
      isLoading: false,
      imageLoadError: true,
    });

    result.retryFailed();
    result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });
    flushEffects();
    await vi.waitFor(() => expect(mocks.hydrate).toHaveBeenCalledTimes(3));
    await settle();
    result = RenderHook({
      workspacePublicId: WORKSPACE_ONE,
      imagePublicIds: ids,
      canvasApi: canvas.api,
    });

    expect(result).toMatchObject({
      total: 2,
      loaded: 2,
      failed: 0,
      isLoading: false,
      imageLoadError: false,
    });
    expect(
      mocks.hydrate.mock.calls.map(
        ([input]) =>
          (input as { resource: WorkspaceCanvasImageResource }).resource
            .publicId,
      ),
    ).toEqual([badId, goodId, badId]);
  });
});
