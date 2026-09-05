import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { VisualWallItemPatch } from "~/components/visual-wall/VisualWall";
import { placeVisualWallImages } from "~/components/visual-wall/visual-wall-layout";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import {
  hashResourceFile,
  uploadResourceFile,
} from "~/views/card/components/resource-upload-queue";
import { applySavedVisualWallChange } from "../../../components/visual-wall/visual-wall-cache";
import { getNextVisualWallZIndex } from "../../../components/visual-wall/visual-wall-interactions";
import { toWorkspaceVisualWallItems } from "./workspace-visual-wall-adapter";
import { validateWorkspaceVisualWallImageFile } from "./workspace-visual-wall-image";

interface UploadedWorkspaceImage {
  publicId: string;
  title: string;
  viewUrl: string;
  width: number | null;
  height: number | null;
}

const WORKSPACE_VISUAL_WALL_STALE = "WORKSPACE_VISUAL_WALL_STALE";

const isVisualWallConflict = (error: unknown) =>
  error instanceof Error && error.message === "VISUAL_WALL_CONFLICT";

const isStaleWorkspaceOperation = (error: unknown) =>
  error instanceof Error && error.message === WORKSPACE_VISUAL_WALL_STALE;

const runUploadQueue = async <Item, Result>(
  items: readonly Item[],
  worker: (item: Item) => Promise<Result>,
  concurrency = 3,
) => {
  const results: Result[] = [];
  const failures: unknown[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results.push(await worker(items[index] as Item));
        } catch (error) {
          failures.push(error);
        }
      }
    }),
  );
  return { results, failures };
};

export function useWorkspaceVisualWall({
  workspacePublicId,
  canEdit,
}: {
  workspacePublicId: string;
  canEdit: boolean;
}) {
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const wallQuery = api.workspaceVisualWall.get.useQuery({ workspacePublicId });
  const createUpload = api.workspaceCanvas.createImageUpload.useMutation();
  const confirmUpload = api.workspaceCanvas.confirmImageUpload.useMutation();
  const deleteImage = api.workspaceCanvas.deleteImage.useMutation();
  const addImages = api.workspaceVisualWall.addImages.useMutation();
  const updateItem = api.workspaceVisualWall.updateItem.useMutation();
  const removeItem = api.workspaceVisualWall.removeItem.useMutation();
  const setFreeformLink = api.workspaceVisualWall.setFreeformLink.useMutation();
  const [pendingOperations, setPendingOperations] = useState(0);
  const versionRef = useRef(0);
  const snapshotRef = useRef(wallQuery.data);
  const operationQueueRef = useRef(Promise.resolve());
  const abortControllersRef = useRef(new Set<AbortController>());
  const activeWorkspaceRef = useRef<string | null>(workspacePublicId);

  snapshotRef.current = wallQuery.data;
  useEffect(() => {
    activeWorkspaceRef.current = workspacePublicId;
    versionRef.current = 0;
    operationQueueRef.current = Promise.resolve();
    const controllers = abortControllersRef.current;
    return () => {
      activeWorkspaceRef.current = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [workspacePublicId]);

  useEffect(() => {
    versionRef.current = Math.max(
      versionRef.current,
      wallQuery.data?.version ?? 0,
    );
  }, [wallQuery.data?.version, workspacePublicId]);

  const isCurrentWorkspace = useCallback(
    () => activeWorkspaceRef.current === workspacePublicId,
    [workspacePublicId],
  );

  const refresh = useCallback(async () => {
    await utils.workspaceVisualWall.get.invalidate({ workspacePublicId });
  }, [utils.workspaceVisualWall.get, workspacePublicId]);

  const enqueue = useCallback(<Result>(operation: () => Promise<Result>) => {
    setPendingOperations((count) => count + 1);
    const result = operationQueueRef.current.then(operation);
    operationQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() =>
      setPendingOperations((count) => Math.max(0, count - 1)),
    );
  }, []);

  type WallSnapshot = NonNullable<typeof wallQuery.data>;

  const acceptCasResult = useCallback(
    async (
      result:
        | { status: "saved"; version: number; updatedAt: Date }
        | { status: "conflict"; remoteVersion: number },
      updateSnapshot?: (snapshot: WallSnapshot) => WallSnapshot,
    ) => {
      if (!isCurrentWorkspace()) return false;
      if (result.status === "saved") {
        versionRef.current = Math.max(versionRef.current, result.version);
        const cache = { accepted: false };
        if (updateSnapshot) {
          await utils.workspaceVisualWall.get.cancel({ workspacePublicId });
          if (!isCurrentWorkspace()) return false;
          utils.workspaceVisualWall.get.setData(
            { workspacePublicId },
            (current) => {
              const next = applySavedVisualWallChange(
                current,
                result,
                updateSnapshot,
              );
              cache.accepted = next !== undefined;
              versionRef.current = Math.max(
                versionRef.current,
                next?.version ?? 0,
              );
              snapshotRef.current = next ?? current;
              return next ?? current;
            },
          );
        }
        if (!cache.accepted) await refresh();
        return isCurrentWorkspace();
      }
      versionRef.current = result.remoteVersion;
      await refresh();
      if (!isCurrentWorkspace()) return false;
      showPopup({
        header: t`The visual wall changed`,
        message: t`The latest version was loaded. Try the change again.`,
        icon: "error",
      });
      return false;
    },
    [
      isCurrentWorkspace,
      refresh,
      showPopup,
      utils.workspaceVisualWall.get,
      workspacePublicId,
    ],
  );

  const uploadWorkspaceImage = useCallback(
    async (file: File): Promise<UploadedWorkspaceImage> => {
      const contentType = validateWorkspaceVisualWallImageFile(file);
      const abortController = new AbortController();
      abortControllersRef.current.add(abortController);
      try {
        const sha256 = await hashResourceFile(file);
        if (!isCurrentWorkspace()) {
          throw new Error(WORKSPACE_VISUAL_WALL_STALE);
        }
        const session = await createUpload.mutateAsync({
          workspacePublicId,
          filename: file.name,
          contentType,
          size: file.size,
          sha256,
        });
        if (!isCurrentWorkspace()) {
          throw new Error(WORKSPACE_VISUAL_WALL_STALE);
        }
        await uploadResourceFile(
          session.url,
          file,
          contentType,
          abortController.signal,
          () => undefined,
        );
        if (!isCurrentWorkspace()) {
          throw new Error(WORKSPACE_VISUAL_WALL_STALE);
        }
        const image = await confirmUpload.mutateAsync({
          workspacePublicId,
          uploadSessionPublicId: session.uploadSessionPublicId,
        });
        if (!isCurrentWorkspace()) {
          await Promise.allSettled([
            deleteImage.mutateAsync({
              workspacePublicId,
              imagePublicId: image.publicId,
            }),
          ]);
          throw new Error(WORKSPACE_VISUAL_WALL_STALE);
        }
        return image;
      } finally {
        abortControllersRef.current.delete(abortController);
      }
    },
    [
      confirmUpload,
      createUpload,
      deleteImage,
      isCurrentWorkspace,
      workspacePublicId,
    ],
  );

  const discardImages = useCallback(
    async (images: readonly UploadedWorkspaceImage[]) => {
      await Promise.allSettled(
        images.map((image) =>
          deleteImage.mutateAsync({
            workspacePublicId,
            imagePublicId: image.publicId,
          }),
        ),
      );
    },
    [deleteImage, workspacePublicId],
  );

  const handleFiles = useCallback(
    (files: File[]) =>
      enqueue(async () => {
        if (!canEdit || files.length === 0) return;
        const uploaded = await runUploadQueue(files, uploadWorkspaceImage);
        if (!isCurrentWorkspace()) {
          await discardImages(uploaded.results);
          return;
        }
        let savedCount = 0;
        try {
          if (uploaded.results.length === 0) {
            showPopup({
              header: t`Images could not be added`,
              message: t`Use JPEG, PNG or WebP images up to 10 MiB each.`,
              icon: "error",
            });
            return;
          }
          const currentItems = snapshotRef.current?.items ?? [];
          const positions = placeVisualWallImages(
            currentItems,
            uploaded.results.map((image) => ({
              width: image.width ?? 320,
              height: image.height ?? 240,
            })),
          );
          const mutationItems = positions.map((position, index) => {
            const image = uploaded.results[index];
            if (!image) {
              throw new Error("VISUAL_WALL_IMAGE_PLACEMENT_MISSING");
            }
            return {
              imagePublicId: image.publicId,
              ...position,
              zIndex: getNextVisualWallZIndex(currentItems, index + 1),
            };
          });
          for (let index = 0; index < mutationItems.length; index += 20) {
            if (!isCurrentWorkspace()) {
              await discardImages(uploaded.results.slice(savedCount));
              return;
            }
            const batch = mutationItems.slice(index, index + 20);
            const result = await addImages.mutateAsync({
              workspacePublicId,
              expectedVersion: versionRef.current,
              items: batch,
            });
            if (result.status === "saved") {
              savedCount += batch.length;
            }
            if (!isCurrentWorkspace()) {
              await discardImages(uploaded.results.slice(savedCount));
              return;
            }
            if (result.status === "conflict") {
              await discardImages(uploaded.results.slice(savedCount));
              await acceptCasResult(result);
              return;
            }
            versionRef.current = result.version;
          }
          await refresh();
          if (!isCurrentWorkspace()) return;
          if (uploaded.failures.length > 0) {
            showPopup({
              header: t`Some images were skipped`,
              message: t`The valid images were added. Check the remaining files and try again.`,
              icon: "success",
            });
          }
        } catch (error) {
          await discardImages(uploaded.results.slice(savedCount));
          if (isStaleWorkspaceOperation(error) || !isCurrentWorkspace()) {
            return;
          }
          if (savedCount > 0) {
            await refresh();
            if (!isCurrentWorkspace()) return;
            showPopup({
              header: t`Some images could not be added`,
              message: t`The valid images were added. Check the remaining files and try again.`,
              icon: "error",
            });
            return;
          }
          throw error;
        }
      }).catch(() => {
        if (!isCurrentWorkspace()) return;
        showPopup({
          header: t`Images could not be added`,
          message: t`The wall was not changed. Try again.`,
          icon: "error",
        });
      }),
    [
      acceptCasResult,
      addImages,
      canEdit,
      discardImages,
      enqueue,
      isCurrentWorkspace,
      refresh,
      showPopup,
      uploadWorkspaceImage,
      workspacePublicId,
    ],
  );

  const handleUpdate = useCallback(
    (itemPublicId: string, patch: VisualWallItemPatch) =>
      enqueue(async () => {
        if (!canEdit || !isCurrentWorkspace()) return;
        const result = await updateItem.mutateAsync({
          workspacePublicId,
          itemPublicId,
          expectedVersion: versionRef.current,
          ...patch,
        });
        if (!isCurrentWorkspace()) {
          throw new Error(WORKSPACE_VISUAL_WALL_STALE);
        }
        if (
          !(await acceptCasResult(result, (snapshot) => ({
            ...snapshot,
            items: snapshot.items.map((item) =>
              item.publicId === itemPublicId ? { ...item, ...patch } : item,
            ),
          })))
        ) {
          throw new Error("VISUAL_WALL_CONFLICT");
        }
      }).catch((error: unknown) => {
        if (isStaleWorkspaceOperation(error) || !isCurrentWorkspace()) return;
        if (!isVisualWallConflict(error)) {
          void refresh();
          showPopup({
            header: t`The image could not be moved`,
            message: t`Its last saved position was restored. Try again.`,
            icon: "error",
          });
        }
        throw error;
      }),
    [
      acceptCasResult,
      canEdit,
      enqueue,
      isCurrentWorkspace,
      refresh,
      showPopup,
      updateItem,
      workspacePublicId,
    ],
  );

  const handleRemove = useCallback(
    (itemPublicId: string) =>
      enqueue(async () => {
        if (!canEdit || !isCurrentWorkspace()) return;
        const result = await removeItem.mutateAsync({
          workspacePublicId,
          itemPublicId,
          expectedVersion: versionRef.current,
        });
        if (!isCurrentWorkspace()) {
          throw new Error(WORKSPACE_VISUAL_WALL_STALE);
        }
        if (
          !(await acceptCasResult(result, (snapshot) => ({
            ...snapshot,
            items: snapshot.items.filter(
              (item) => item.publicId !== itemPublicId,
            ),
          })))
        ) {
          throw new Error("VISUAL_WALL_CONFLICT");
        }
      }).catch((error: unknown) => {
        if (isStaleWorkspaceOperation(error) || !isCurrentWorkspace()) return;
        if (!isVisualWallConflict(error)) {
          void refresh();
          showPopup({
            header: t`The image could not be removed`,
            message: t`The wall was not changed. Try again.`,
            icon: "error",
          });
        }
        throw error;
      }),
    [
      acceptCasResult,
      canEdit,
      enqueue,
      isCurrentWorkspace,
      refresh,
      removeItem,
      showPopup,
      workspacePublicId,
    ],
  );

  const handleSetFreeformUrl = useCallback(
    (freeformUrl: string | null) =>
      enqueue(async () => {
        if (!canEdit || !isCurrentWorkspace()) return;
        const result = await setFreeformLink.mutateAsync({
          workspacePublicId,
          expectedVersion: versionRef.current,
          freeformUrl,
        });
        if (!isCurrentWorkspace()) {
          throw new Error(WORKSPACE_VISUAL_WALL_STALE);
        }
        if (
          !(await acceptCasResult(result, (snapshot) => ({
            ...snapshot,
            freeformUrl,
          })))
        ) {
          throw new Error("VISUAL_WALL_CONFLICT");
        }
      }),
    [
      acceptCasResult,
      canEdit,
      enqueue,
      isCurrentWorkspace,
      setFreeformLink,
      workspacePublicId,
    ],
  );

  const items = useMemo(
    () => toWorkspaceVisualWallItems(wallQuery.data?.items ?? []),
    [wallQuery.data?.items],
  );

  return {
    items,
    freeformUrl: wallQuery.data?.freeformUrl ?? null,
    canEdit: canEdit && !(wallQuery.data?.viewModeEnabled ?? false),
    isLoading: wallQuery.isLoading,
    isError: wallQuery.isError,
    isBusy: pendingOperations > 0,
    retry: () => wallQuery.refetch(),
    onFiles: handleFiles,
    onUpdate: handleUpdate,
    onRemove: handleRemove,
    onSetFreeformUrl: handleSetFreeformUrl,
  };
}
