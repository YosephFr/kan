import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceVisualWall } from "./use-workspace-visual-wall";

interface MockWallData {
  version: number;
  freeformUrl: string | null;
  viewModeEnabled: boolean;
  items: { zIndex: number }[];
}

type EffectCleanup = void | (() => void);

interface HookRuntime {
  beginRender: () => void;
  dispose: () => void;
  flushEffects: () => void;
  useEffect: (
    effect: () => EffectCleanup,
    dependencies?: readonly unknown[],
  ) => void;
  useRef: <Value>(initialValue: Value) => { current: Value };
  useState: <Value>(
    initialValue: Value | (() => Value),
  ) => [Value, (next: Value | ((current: Value) => Value)) => void];
}

const reactRuntime = vi.hoisted(() => ({
  current: undefined as HookRuntime | undefined,
}));

const mocks = vi.hoisted(() => ({
  addImages:
    vi.fn<
      (
        input: Record<string, unknown>,
      ) => Promise<
        | { status: "saved"; version: number }
        | { status: "conflict"; remoteVersion: number }
      >
    >(),
  confirmUpload: vi.fn<
    (input: Record<string, unknown>) => Promise<{
      publicId: string;
      title: string;
      viewUrl: string;
      width: number | null;
      height: number | null;
    }>
  >(),
  createUpload:
    vi.fn<
      (
        input: Record<string, unknown>,
      ) => Promise<{ url: string; uploadSessionPublicId: string }>
    >(),
  deleteImage: vi.fn<(input: Record<string, unknown>) => Promise<void>>(),
  hashResourceFile: vi.fn<(file: File) => Promise<string>>(),
  invalidate: vi.fn<(input: Record<string, unknown>) => Promise<void>>(),
  refetch: vi.fn<() => Promise<unknown>>(),
  removeItem:
    vi.fn<
      (
        input: Record<string, unknown>,
      ) => Promise<
        | { status: "saved"; version: number }
        | { status: "conflict"; remoteVersion: number }
      >
    >(),
  setFreeformLink:
    vi.fn<
      (
        input: Record<string, unknown>,
      ) => Promise<
        | { status: "saved"; version: number }
        | { status: "conflict"; remoteVersion: number }
      >
    >(),
  showPopup:
    vi.fn<(input: { header: string; message: string; icon: string }) => void>(),
  updateItem:
    vi.fn<
      (
        input: Record<string, unknown>,
      ) => Promise<
        | { status: "saved"; version: number }
        | { status: "conflict"; remoteVersion: number }
      >
    >(),
  uploadResourceFile:
    vi.fn<
      (
        url: string,
        file: File,
        contentType: string,
        signal: AbortSignal,
        onProgress: () => void,
      ) => Promise<void>
    >(),
  validateImage: vi.fn<(file: File) => string>(),
  wallQuery: {
    data: undefined as MockWallData | undefined,
    isError: false,
    isLoading: false,
  },
}));

vi.mock("react", () => ({
  useCallback: <Callback>(callback: Callback) => callback,
  useEffect: (effect: () => EffectCleanup, dependencies?: readonly unknown[]) =>
    reactRuntime.current?.useEffect(effect, dependencies),
  useMemo: <Value>(factory: () => Value) => factory(),
  useRef: <Value>(initialValue: Value) =>
    reactRuntime.current?.useRef(initialValue),
  useState: <Value>(initialValue: Value | (() => Value)) =>
    reactRuntime.current?.useState(initialValue),
}));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("~/providers/popup", () => ({
  usePopup: () => ({ showPopup: mocks.showPopup }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      workspaceVisualWall: { get: { invalidate: mocks.invalidate } },
    }),
    workspaceCanvas: {
      confirmImageUpload: {
        useMutation: () => ({ mutateAsync: mocks.confirmUpload }),
      },
      createImageUpload: {
        useMutation: () => ({ mutateAsync: mocks.createUpload }),
      },
      deleteImage: {
        useMutation: () => ({ mutateAsync: mocks.deleteImage }),
      },
    },
    workspaceVisualWall: {
      addImages: { useMutation: () => ({ mutateAsync: mocks.addImages }) },
      get: {
        useQuery: () => ({ ...mocks.wallQuery, refetch: mocks.refetch }),
      },
      removeItem: { useMutation: () => ({ mutateAsync: mocks.removeItem }) },
      setFreeformLink: {
        useMutation: () => ({ mutateAsync: mocks.setFreeformLink }),
      },
      updateItem: { useMutation: () => ({ mutateAsync: mocks.updateItem }) },
    },
  },
}));

vi.mock("~/views/card/components/resource-upload-queue", () => ({
  hashResourceFile: mocks.hashResourceFile,
  uploadResourceFile: mocks.uploadResourceFile,
}));

vi.mock("~/components/visual-wall/visual-wall-layout", () => ({
  placeVisualWallImages: (
    _currentItems: unknown[],
    images: { width: number; height: number }[],
  ) =>
    images.map((image, index) => ({
      x: 24 + index * 32,
      y: 24 + index * 32,
      width: image.width,
      height: image.height,
    })),
}));

vi.mock("./workspace-visual-wall-adapter", () => ({
  toWorkspaceVisualWallItems: (items: unknown[]) => items,
}));

vi.mock("./workspace-visual-wall-image", () => ({
  validateWorkspaceVisualWallImageFile: mocks.validateImage,
}));

const dependenciesEqual = (
  left: readonly unknown[] | undefined,
  right: readonly unknown[] | undefined,
) =>
  left !== undefined &&
  right !== undefined &&
  left.length === right.length &&
  left.every((value, index) => Object.is(value, right[index]));

const createHookRuntime = (): HookRuntime => {
  const refs: { current: unknown }[] = [];
  const states: unknown[] = [];
  const effects: {
    dependencies: readonly unknown[] | undefined;
    cleanup?: () => void;
  }[] = [];
  let pendingEffects: {
    index: number;
    effect: () => EffectCleanup;
    dependencies: readonly unknown[] | undefined;
  }[] = [];
  let refIndex = 0;
  let stateIndex = 0;
  let effectIndex = 0;

  return {
    beginRender: () => {
      refIndex = 0;
      stateIndex = 0;
      effectIndex = 0;
      pendingEffects = [];
    },
    dispose: () => {
      for (const effect of effects) effect.cleanup?.();
    },
    flushEffects: () => {
      for (const pending of pendingEffects) {
        effects[pending.index]?.cleanup?.();
        const cleanup = pending.effect();
        effects[pending.index] = {
          dependencies: pending.dependencies,
          cleanup: typeof cleanup === "function" ? cleanup : undefined,
        };
      }
      pendingEffects = [];
    },
    useEffect: (effect, dependencies) => {
      const index = effectIndex++;
      if (dependenciesEqual(effects[index]?.dependencies, dependencies)) return;
      pendingEffects.push({ index, effect, dependencies });
    },
    useRef: <Value>(initialValue: Value) => {
      const index = refIndex++;
      refs[index] ??= { current: initialValue };
      return refs[index] as { current: Value };
    },
    useState: <Value>(initialValue: Value | (() => Value)) => {
      const index = stateIndex++;
      if (!(index in states)) {
        states[index] =
          typeof initialValue === "function"
            ? (initialValue as () => Value)()
            : initialValue;
      }
      return [
        states[index] as Value,
        (next: Value | ((current: Value) => Value)) => {
          states[index] =
            typeof next === "function"
              ? (next as (current: Value) => Value)(states[index] as Value)
              : next;
        },
      ];
    },
  };
};

const RenderWallHook = (runtime: HookRuntime, workspacePublicId: string) => {
  runtime.beginRender();
  reactRuntime.current = runtime;
  const result = useWorkspaceVisualWall({ workspacePublicId, canEdit: true });
  reactRuntime.current = undefined;
  runtime.flushEffects();
  return result;
};

const loadWall = (
  runtime: HookRuntime,
  workspacePublicId: string,
  version: number,
) => {
  mocks.wallQuery.data = undefined;
  RenderWallHook(runtime, workspacePublicId);
  mocks.wallQuery.data = {
    version,
    freeformUrl: null,
    viewModeEnabled: false,
    items: [],
  };
  return RenderWallHook(runtime, workspacePublicId);
};

const makeImage = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

beforeEach(() => {
  vi.resetAllMocks();
  reactRuntime.current = undefined;
  mocks.wallQuery.data = undefined;
  mocks.wallQuery.isError = false;
  mocks.wallQuery.isLoading = false;
  mocks.hashResourceFile.mockResolvedValue("sha256");
  mocks.deleteImage.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue(undefined);
  mocks.uploadResourceFile.mockResolvedValue(undefined);
  mocks.validateImage.mockReturnValue("image/png");
});

describe("useWorkspaceVisualWall", () => {
  it("uses a cached wall version on the first mutation after mount", async () => {
    const runtime = createHookRuntime();
    mocks.wallQuery.data = {
      version: 7,
      freeformUrl: null,
      viewModeEnabled: false,
      items: [],
    };
    mocks.removeItem.mockResolvedValue({ status: "saved", version: 8 });

    const hook = RenderWallHook(runtime, "workspace-a");
    await hook.onRemove("item-1");

    expect(mocks.removeItem).toHaveBeenCalledWith({
      workspacePublicId: "workspace-a",
      itemPublicId: "item-1",
      expectedVersion: 7,
    });
    runtime.dispose();
  });

  it("keeps successful images when another upload in the same selection fails", async () => {
    const runtime = createHookRuntime();
    const hook = loadWall(runtime, "workspace-a", 4);

    mocks.createUpload.mockImplementation((input) => {
      if (input.filename === "broken.png") {
        return Promise.reject(new Error("upload rejected"));
      }
      return Promise.resolve({
        url: "https://uploads.invalid/session",
        uploadSessionPublicId: "upload-1",
      });
    });
    mocks.confirmUpload.mockResolvedValue({
      publicId: "image-good",
      title: "good.png",
      viewUrl: "/api/workspaces/workspace-a/images/image-good",
      width: 640,
      height: 480,
    });
    mocks.addImages.mockResolvedValue({ status: "saved", version: 5 });

    await hook.onFiles([makeImage("good.png"), makeImage("broken.png")]);

    expect(mocks.addImages).toHaveBeenCalledWith({
      workspacePublicId: "workspace-a",
      expectedVersion: 4,
      items: [
        {
          imagePublicId: "image-good",
          x: 24,
          y: 24,
          width: 640,
          height: 480,
          zIndex: 1,
        },
      ],
    });
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    expect(mocks.showPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        header: "Some images were skipped",
        icon: "success",
      }),
    );
    runtime.dispose();
  });

  it("reloads the remote snapshot after a CAS conflict and uses its version next", async () => {
    const runtime = createHookRuntime();
    const hook = loadWall(runtime, "workspace-a", 7);
    mocks.updateItem.mockResolvedValue({
      status: "conflict",
      remoteVersion: 9,
    });
    mocks.removeItem.mockResolvedValue({ status: "saved", version: 10 });

    await expect(
      hook.onUpdate("item-1", {
        x: 120,
        y: 240,
        width: 640,
        height: 480,
        zIndex: 3,
      }),
    ).rejects.toThrow("VISUAL_WALL_CONFLICT");

    expect(mocks.updateItem).toHaveBeenCalledWith({
      workspacePublicId: "workspace-a",
      itemPublicId: "item-1",
      expectedVersion: 7,
      x: 120,
      y: 240,
      width: 640,
      height: 480,
      zIndex: 3,
    });
    expect(mocks.showPopup).toHaveBeenCalledTimes(1);
    expect(mocks.showPopup).toHaveBeenCalledWith(
      expect.objectContaining({ header: "The visual wall changed" }),
    );
    expect(mocks.invalidate).toHaveBeenCalledWith({
      workspacePublicId: "workspace-a",
    });

    await hook.onRemove("item-2");

    expect(mocks.removeItem).toHaveBeenCalledWith({
      workspacePublicId: "workspace-a",
      itemPublicId: "item-2",
      expectedVersion: 9,
    });
    runtime.dispose();
  });

  it("aborts an in-flight image transfer and suppresses its stale result after a workspace change", async () => {
    const runtime = createHookRuntime();
    const oldHook = loadWall(runtime, "workspace-a", 2);
    let observedSignal: AbortSignal | undefined;
    let markUploadStarted: (() => void) | undefined;
    const uploadStarted = new Promise<void>((resolve) => {
      markUploadStarted = resolve;
    });
    mocks.createUpload.mockResolvedValue({
      url: "https://uploads.invalid/session",
      uploadSessionPublicId: "upload-1",
    });
    mocks.uploadResourceFile.mockImplementation(
      async (_url, _file, _contentType, signal) => {
        observedSignal = signal;
        markUploadStarted?.();
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
    );

    const oldUpload = oldHook.onFiles([makeImage("old-workspace.png")]);
    await uploadStarted;

    mocks.wallQuery.data = undefined;
    RenderWallHook(runtime, "workspace-b");

    await oldUpload;

    expect(observedSignal?.aborted).toBe(true);
    expect(mocks.confirmUpload).not.toHaveBeenCalled();
    expect(mocks.addImages).not.toHaveBeenCalled();
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("discards an image confirmed after the old workspace wall unmounts", async () => {
    const oldRuntime = createHookRuntime();
    const oldHook = loadWall(oldRuntime, "workspace-a", 2);
    let resolveConfirmation:
      | ((image: {
          publicId: string;
          title: string;
          viewUrl: string;
          width: number;
          height: number;
        }) => void)
      | undefined;
    let markConfirmationStarted: (() => void) | undefined;
    const confirmationStarted = new Promise<void>((resolve) => {
      markConfirmationStarted = resolve;
    });
    mocks.createUpload.mockResolvedValue({
      url: "https://uploads.invalid/session",
      uploadSessionPublicId: "upload-1",
    });
    mocks.confirmUpload.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfirmation = resolve;
          markConfirmationStarted?.();
        }),
    );

    const oldUpload = oldHook.onFiles([makeImage("late-confirmation.png")]);
    await confirmationStarted;

    oldRuntime.dispose();
    const newRuntime = createHookRuntime();
    loadWall(newRuntime, "workspace-b", 3);
    resolveConfirmation?.({
      publicId: "image-late",
      title: "late-confirmation.png",
      viewUrl: "/api/workspaces/workspace-a/images/image-late",
      width: 640,
      height: 480,
    });
    await oldUpload;

    expect(mocks.deleteImage).toHaveBeenCalledWith({
      workspacePublicId: "workspace-a",
      imagePublicId: "image-late",
    });
    expect(mocks.addImages).not.toHaveBeenCalled();
    expect(mocks.showPopup).not.toHaveBeenCalled();
    newRuntime.dispose();
  });

  it("deletes unattached uploads when an obsolete add returns a conflict", async () => {
    const oldRuntime = createHookRuntime();
    const oldHook = loadWall(oldRuntime, "workspace-a", 5);
    let resolveAdd:
      | ((result: { status: "conflict"; remoteVersion: number }) => void)
      | undefined;
    let markAddStarted: (() => void) | undefined;
    const addStarted = new Promise<void>((resolve) => {
      markAddStarted = resolve;
    });
    mocks.createUpload.mockResolvedValue({
      url: "https://uploads.invalid/session",
      uploadSessionPublicId: "upload-1",
    });
    mocks.confirmUpload.mockResolvedValue({
      publicId: "image-conflict",
      title: "conflict.png",
      viewUrl: "/api/workspaces/workspace-a/images/image-conflict",
      width: 640,
      height: 480,
    });
    mocks.addImages.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
          markAddStarted?.();
        }),
    );

    const oldUpload = oldHook.onFiles([makeImage("conflict.png")]);
    await addStarted;

    oldRuntime.dispose();
    const newRuntime = createHookRuntime();
    loadWall(newRuntime, "workspace-b", 6);
    resolveAdd?.({ status: "conflict", remoteVersion: 99 });
    await oldUpload;

    expect(mocks.deleteImage).toHaveBeenCalledWith({
      workspacePublicId: "workspace-a",
      imagePublicId: "image-conflict",
    });
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.showPopup).not.toHaveBeenCalled();
    newRuntime.dispose();
  });

  it("does not apply an old conflict after unmounting during cleanup", async () => {
    const oldRuntime = createHookRuntime();
    const oldHook = loadWall(oldRuntime, "workspace-a", 5);
    let resolveDeletion: (() => void) | undefined;
    let markDeletionStarted: (() => void) | undefined;
    const deletionStarted = new Promise<void>((resolve) => {
      markDeletionStarted = resolve;
    });
    mocks.createUpload.mockResolvedValue({
      url: "https://uploads.invalid/session",
      uploadSessionPublicId: "upload-1",
    });
    mocks.confirmUpload.mockResolvedValue({
      publicId: "image-conflict",
      title: "conflict.png",
      viewUrl: "/api/workspaces/workspace-a/images/image-conflict",
      width: 640,
      height: 480,
    });
    mocks.addImages.mockResolvedValue({
      status: "conflict",
      remoteVersion: 99,
    });
    mocks.deleteImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDeletion = resolve;
          markDeletionStarted?.();
        }),
    );

    const oldUpload = oldHook.onFiles([makeImage("conflict.png")]);
    await deletionStarted;

    oldRuntime.dispose();
    const newRuntime = createHookRuntime();
    loadWall(newRuntime, "workspace-b", 6);
    resolveDeletion?.();
    await oldUpload;

    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.showPopup).not.toHaveBeenCalled();
    newRuntime.dispose();
  });

  it("keeps a saved batch and deletes only the unsubmitted tail after unmount", async () => {
    const oldRuntime = createHookRuntime();
    const oldHook = loadWall(oldRuntime, "workspace-a", 5);
    let resolveAdd:
      | ((result: { status: "saved"; version: number }) => void)
      | undefined;
    let markAddStarted: (() => void) | undefined;
    const addStarted = new Promise<void>((resolve) => {
      markAddStarted = resolve;
    });
    mocks.createUpload.mockImplementation((input) => {
      const filename = String(input.filename);
      return Promise.resolve({
        url: "https://uploads.invalid/session",
        uploadSessionPublicId: filename,
      });
    });
    mocks.confirmUpload.mockImplementation((input) => {
      const publicId = String(input.uploadSessionPublicId);
      return Promise.resolve({
        publicId,
        title: publicId,
        viewUrl: `/api/workspaces/workspace-a/images/${publicId}`,
        width: 640,
        height: 480,
      });
    });
    mocks.addImages.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
          markAddStarted?.();
        }),
    );
    const files = Array.from({ length: 21 }, (_, index) =>
      makeImage(`image-${index}.png`),
    );

    const oldUpload = oldHook.onFiles(files);
    await addStarted;

    oldRuntime.dispose();
    const newRuntime = createHookRuntime();
    loadWall(newRuntime, "workspace-b", 6);
    resolveAdd?.({ status: "saved", version: 6 });
    await oldUpload;

    const submittedItems = (
      mocks.addImages.mock.calls[0]?.[0].items as
        | { imagePublicId: string }[]
        | undefined
    )?.map((item) => item.imagePublicId);
    const deletedImagePublicId = mocks.deleteImage.mock.calls[0]?.[0]
      .imagePublicId as string | undefined;
    expect(submittedItems).toHaveLength(20);
    expect(mocks.addImages).toHaveBeenCalledTimes(1);
    expect(mocks.deleteImage).toHaveBeenCalledTimes(1);
    expect(deletedImagePublicId).toBeDefined();
    expect(submittedItems).not.toContain(deletedImagePublicId);
    expect(mocks.showPopup).not.toHaveBeenCalled();
    newRuntime.dispose();
  });
});
