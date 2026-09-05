import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { UploadCardResource } from "./card-resource-types";
import type {
  VisualWallItem,
  VisualWallItemPatch,
} from "~/components/visual-wall/VisualWall";
import { VisualWall } from "~/components/visual-wall/VisualWall";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { isPublicVisibilityAcknowledgementError } from "~/utils/card-workspace";
import { invalidateCard } from "~/utils/cardInvalidation";
import { applySavedVisualWallChange } from "../../../components/visual-wall/visual-wall-cache";
import { getNextVisualWallZIndex } from "../../../components/visual-wall/visual-wall-interactions";
import {
  normalizeVisualWallRect,
  placeVisualWallImages,
} from "../../../components/visual-wall/visual-wall-layout";
import { validateAttachmentFile } from "./attachment-upload";
import { CardVisualWallResourceDialog } from "./CardVisualWallResourceDialog";
import { hashResourceFile, uploadResourceFile } from "./resource-upload-queue";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const roundWallPatch = (
  patch: VisualWallItemPatch,
): VisualWallItemPatch => ({
  x: Math.round(patch.x),
  y: Math.round(patch.y),
  width: Math.round(patch.width),
  height: Math.round(patch.height),
  zIndex: Math.round(patch.zIndex),
});

type WallMutationResult =
  | { status: "saved"; version: number; updatedAt: Date }
  | { status: "conflict"; remoteVersion: number }
  | { status: "public_ack_required" };

const WALL_MUTATION_ABORTED = "VISUAL_WALL_MUTATION_ABORTED";

const isWallMutationAborted = (error: unknown) =>
  error instanceof Error && error.message === WALL_MUTATION_ABORTED;

const getFileAspectRatio = async (file: File) => {
  if (typeof createImageBitmap === "function") {
    const bitmapRatio = await createImageBitmap(file)
      .then((bitmap) => {
        const ratio = bitmap.width / Math.max(1, bitmap.height);
        bitmap.close();
        return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
      })
      .catch(() => null);
    if (bitmapRatio) return bitmapRatio;
  }

  if (typeof window === "undefined") return 4 / 3;
  const objectUrl = URL.createObjectURL(file);
  return new Promise<number>((resolve) => {
    const image = new window.Image();
    const finish = (ratio: number) => {
      URL.revokeObjectURL(objectUrl);
      resolve(Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3);
    };
    image.onload = () =>
      finish(image.naturalWidth / Math.max(1, image.naturalHeight));
    image.onerror = () => finish(4 / 3);
    image.src = objectUrl;
  });
};

const getResourceAspectRatio = (url: string) =>
  new Promise<number>((resolve) => {
    const image = new window.Image();
    image.onload = () =>
      resolve(image.naturalWidth / Math.max(1, image.naturalHeight));
    image.onerror = () => resolve(4 / 3);
    image.src = url;
  });

export const getAppendPosition = (
  items: readonly VisualWallItem[],
  index: number,
  ratios: readonly number[],
) => {
  const placement = placeVisualWallImages(
    items,
    Array.from({ length: index + 1 }, (_, imageIndex) => {
      const ratio = ratios[imageIndex];
      return {
        width: ratio && Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3,
        height: 1,
      };
    }),
  )[index];
  if (!placement) throw new Error("VISUAL_WALL_IMAGE_PLACEMENT_MISSING");
  return {
    ...normalizeVisualWallRect(placement),
    zIndex: getNextVisualWallZIndex(items, index + 1),
  };
};

export function CardVisualWallView({
  cardPublicId,
  canEdit,
  isPublicBoard,
  onContentChange,
}: {
  cardPublicId: string;
  canEdit: boolean;
  isPublicBoard: boolean;
  onContentChange?: (hasContent: boolean) => void;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [publicVisibilityAcknowledged, setPublicVisibilityAcknowledged] =
    useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const versionRef = useRef(0);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const wallQuery = api.cardVisualWall.get.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12, retry: 1 },
  );
  const resourcesQuery = api.cardResource.list.useQuery(
    { cardPublicId },
    { enabled: resourceDialogOpen && canEdit, retry: 1 },
  );
  const addResource = api.cardVisualWall.addResource.useMutation();
  const updateItem = api.cardVisualWall.updateItem.useMutation();
  const removeItem = api.cardVisualWall.removeItem.useMutation();
  const setFreeformLink = api.cardVisualWall.setFreeformLink.useMutation();
  const createUpload = api.cardResource.createUpload.useMutation();
  const confirmUpload = api.cardResource.confirmUpload.useMutation();

  const wall = wallQuery.data;
  const items = useMemo(() => wall?.items ?? [], [wall?.items]);
  const existingPreviews = useMemo(
    () =>
      Object.fromEntries(items.map((item) => [item.resourcePublicId, item])),
    [items],
  );
  const effectiveCanEdit = canEdit && wall?.viewModeEnabled !== true;
  const controlsEnabled =
    effectiveCanEdit && (!isPublicBoard || publicVisibilityAcknowledged);
  const visibilityAcknowledgement =
    isPublicBoard && publicVisibilityAcknowledged ? true : undefined;

  useEffect(() => {
    versionRef.current = Math.max(versionRef.current, wall?.version ?? 0);
  }, [wall?.version]);

  useEffect(() => {
    if (!wall) return;
    onContentChange?.(wall.items.length > 0 || Boolean(wall.freeformUrl));
  }, [onContentChange, wall]);

  const refreshWall = useCallback(async () => {
    const result = await wallQuery.refetch();
    if (result.data) versionRef.current = result.data.version;
    return result.data;
  }, [wallQuery]);

  type WallSnapshot = NonNullable<typeof wallQuery.data>;

  const acceptSavedSnapshot = useCallback(
    async (
      saved: { version: number; updatedAt: Date },
      update: (snapshot: WallSnapshot) => WallSnapshot,
    ) => {
      await utils.cardVisualWall.get.cancel({ cardPublicId });
      const cache = { accepted: false };
      utils.cardVisualWall.get.setData({ cardPublicId }, (current) => {
        const next = applySavedVisualWallChange(current, saved, update);
        cache.accepted = next !== undefined;
        versionRef.current = Math.max(versionRef.current, next?.version ?? 0);
        return next ?? current;
      });
      if (!cache.accepted) await refreshWall();
    },
    [cardPublicId, refreshWall, utils.cardVisualWall.get],
  );

  const handleMutationError = useCallback(
    (error: unknown) => {
      if (isPublicVisibilityAcknowledgementError(error)) {
        setPublicVisibilityAcknowledged(false);
        showPopup({
          header: t`Confirm public visibility`,
          message: t`Review the public-board notice before changing the visual wall.`,
          icon: "error",
        });
        return;
      }
      showPopup({
        header: t`Visual wall could not be updated`,
        message: t`Your resources are safe. Refresh the card and try again.`,
        icon: "error",
      });
    },
    [showPopup],
  );

  const enqueueMutation = useCallback(
    (
      run: (expectedVersion: number) => Promise<WallMutationResult>,
      updateSnapshot?: (snapshot: WallSnapshot) => WallSnapshot,
      refreshCard = true,
    ) => {
      setPendingCount((current) => current + 1);
      const task = mutationQueueRef.current
        .then(async () => {
          let result = await run(versionRef.current);
          if (result.status === "public_ack_required") {
            setPublicVisibilityAcknowledged(false);
            showPopup({
              header: t`Confirm public visibility`,
              message: t`Review the public-board notice before changing the visual wall.`,
              icon: "error",
            });
            throw new Error(WALL_MUTATION_ABORTED);
          }
          if (result.status === "conflict") {
            await refreshWall();
            result = await run(versionRef.current);
          }
          if (result.status === "public_ack_required") {
            setPublicVisibilityAcknowledged(false);
            throw new Error(WALL_MUTATION_ABORTED);
          }
          if (result.status === "conflict") {
            showPopup({
              header: t`Visual wall changed elsewhere`,
              message: t`The latest version is loaded. Repeat the change if it is still needed.`,
              icon: "error",
            });
            await refreshWall();
            throw new Error(WALL_MUTATION_ABORTED);
          }
          versionRef.current = Math.max(versionRef.current, result.version);
          await (updateSnapshot
            ? acceptSavedSnapshot(result, updateSnapshot)
            : refreshWall());
          if (refreshCard) {
            await Promise.all([
              invalidateCard(utils, cardPublicId),
              utils.board.byId.invalidate(),
            ]);
          }
        })
        .catch((error: unknown) => {
          if (!isWallMutationAborted(error)) handleMutationError(error);
          throw error;
        })
        .finally(() => setPendingCount((current) => Math.max(0, current - 1)));
      mutationQueueRef.current = task.catch(() => undefined);
      return task;
    },
    [
      cardPublicId,
      acceptSavedSnapshot,
      handleMutationError,
      refreshWall,
      showPopup,
      utils,
    ],
  );

  const addStoredResource = useCallback(
    async (resource: UploadCardResource, position?: VisualWallItemPatch) => {
      if (!resource.viewUrl || !controlsEnabled) return;
      const preview = existingPreviews[resource.publicId];
      const ratio = position
        ? position.width / Math.max(1, position.height)
        : preview?.widthPx && preview.heightPx
          ? preview.widthPx / preview.heightPx
          : await getResourceAspectRatio(preview?.viewUrl ?? resource.viewUrl);
      const placement = position ?? getAppendPosition(items, 0, [ratio]);
      await enqueueMutation((expectedVersion) =>
        addResource.mutateAsync({
          cardPublicId,
          resourcePublicId: resource.publicId,
          expectedVersion,
          ...placement,
          publicVisibilityAcknowledged: visibilityAcknowledgement,
        }),
      );
      setResourceDialogOpen(false);
    },
    [
      addResource,
      cardPublicId,
      controlsEnabled,
      enqueueMutation,
      existingPreviews,
      items,
      visibilityAcknowledgement,
    ],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!controlsEnabled || files.length === 0) return;
      const validFiles = files.filter((file) => {
        try {
          const contentType = validateAttachmentFile(file);
          return SUPPORTED_IMAGE_TYPES.has(contentType);
        } catch {
          return false;
        }
      });
      if (validFiles.length !== files.length) {
        showPopup({
          header: t`Some images were skipped`,
          message: t`Use JPEG, PNG or WebP files within the card upload limits.`,
          icon: "error",
        });
      }
      if (validFiles.length === 0) return;

      setPendingCount((current) => current + 1);
      try {
        const ratios: number[] = [];
        const baseItems = wallQuery.data?.items ?? [];
        let addedCount = 0;
        let failedCount = 0;
        let mutationAborted = false;
        for (const [index, file] of validFiles.entries()) {
          try {
            ratios.push(await getFileAspectRatio(file));
            const contentType = validateAttachmentFile(file);
            const sha256 = await hashResourceFile(file);
            const session = await createUpload.mutateAsync({
              cardPublicId,
              filename: file.name,
              contentType,
              size: file.size,
              sha256,
              publicVisibilityAcknowledged: visibilityAcknowledgement,
            });
            const controller = new AbortController();
            await uploadResourceFile(
              session.url,
              file,
              contentType,
              controller.signal,
              () => undefined,
            );
            const resource = await confirmUpload.mutateAsync({
              cardPublicId,
              uploadSessionPublicId: session.uploadSessionPublicId,
              publicVisibilityAcknowledged: visibilityAcknowledgement,
            });
            if (resource.kind !== "upload") {
              throw new Error("UPLOAD_RESOURCE_INVALID");
            }
            await addStoredResource(
              resource,
              getAppendPosition(baseItems, index, ratios),
            );
            addedCount += 1;
          } catch (error) {
            failedCount += 1;
            if (isWallMutationAborted(error)) {
              mutationAborted = true;
              break;
            }
            if (isPublicVisibilityAcknowledgementError(error)) {
              handleMutationError(error);
              mutationAborted = true;
              break;
            }
          }
        }
        await utils.cardResource.list.invalidate({ cardPublicId });
        if (failedCount > 0 && !mutationAborted) {
          showPopup({
            header:
              addedCount > 0
                ? t`Some images could not be added`
                : t`Images could not be added`,
            message:
              addedCount > 0
                ? t`The valid images are on the wall. Check the remaining files and try again.`
                : t`No image was added. Check the files and try again.`,
            icon: "error",
          });
        }
      } catch (error) {
        handleMutationError(error);
      } finally {
        setPendingCount((current) => Math.max(0, current - 1));
      }
    },
    [
      addStoredResource,
      cardPublicId,
      confirmUpload,
      controlsEnabled,
      createUpload,
      handleMutationError,
      showPopup,
      utils.cardResource.list,
      visibilityAcknowledgement,
      wallQuery.data?.items,
    ],
  );

  const availableResources = useMemo(
    () =>
      (resourcesQuery.data?.resources ?? []).filter(
        (resource): resource is UploadCardResource =>
          resource.kind === "upload" &&
          resource.contentType.startsWith("image/") &&
          resource.viewUrl !== null,
      ),
    [resourcesQuery.data?.resources],
  );

  if (wallQuery.isLoading) {
    return (
      <div
        className="h-[32rem] animate-pulse bg-light-200 dark:bg-dark-200"
        role="status"
        aria-label={t`Loading visual wall…`}
      />
    );
  }

  if (wallQuery.isError) {
    return (
      <div className="flex min-h-72 items-center justify-center border-y border-light-300 px-6 text-center dark:border-dark-400">
        <div>
          <p className="text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`Visual wall could not be loaded`}
          </p>
          <button
            type="button"
            onClick={() => void wallQuery.refetch()}
            className="mt-3 min-h-11 rounded-md border border-light-500 px-4 text-sm font-medium text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
          >
            {t`Try again`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {effectiveCanEdit && isPublicBoard && (
        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
          <input
            type="checkbox"
            checked={publicVisibilityAcknowledged}
            onChange={(event) =>
              setPublicVisibilityAcknowledged(event.target.checked)
            }
            className="mt-0.5 h-4 w-4 rounded border-amber-500 text-amber-700 focus:ring-amber-600"
          />
          <span>
            <span className="block text-xs font-semibold text-amber-950 dark:text-amber-200">
              {t`This board is public`}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-amber-900 dark:text-amber-300">
              {t`Anyone with access to the public board can see these images and open the Freeform link. I understand and want to continue.`}
            </span>
          </span>
        </label>
      )}
      <VisualWall
        items={items}
        canEdit={controlsEnabled}
        freeformUrl={wall?.freeformUrl ?? null}
        isBusy={pendingCount > 0}
        label={t`Card visual wall`}
        emptyMessage={
          effectiveCanEdit
            ? t`Add project images or connect the shared Freeform board.`
            : t`Project images will appear here when they are added.`
        }
        onFiles={uploadFiles}
        onAddFromResources={() => setResourceDialogOpen(true)}
        onUpdate={(itemPublicId, patch: VisualWallItemPatch) =>
          enqueueMutation(
            (expectedVersion) =>
              updateItem.mutateAsync({
                cardPublicId,
                itemPublicId,
                expectedVersion,
                ...roundWallPatch(patch),
              }),
            (snapshot) => ({
              ...snapshot,
              items: snapshot.items.map((item) =>
                item.publicId === itemPublicId
                  ? { ...item, ...roundWallPatch(patch) }
                  : item,
              ),
            }),
            false,
          )
        }
        onRemove={(itemPublicId) =>
          enqueueMutation(
            (expectedVersion) =>
              removeItem.mutateAsync({
                cardPublicId,
                itemPublicId,
                expectedVersion,
              }),
            (snapshot) => ({
              ...snapshot,
              items: snapshot.items.filter(
                (item) => item.publicId !== itemPublicId,
              ),
            }),
          )
        }
        onSetFreeformUrl={(freeformUrl) =>
          enqueueMutation(
            (expectedVersion) =>
              setFreeformLink.mutateAsync({
                cardPublicId,
                expectedVersion,
                freeformUrl,
                publicVisibilityAcknowledged: visibilityAcknowledgement,
              }),
            (snapshot) => ({ ...snapshot, freeformUrl }),
          )
        }
      />
      <CardVisualWallResourceDialog
        open={resourceDialogOpen}
        resources={availableResources}
        existingPreviews={existingPreviews}
        busy={pendingCount > 0 || resourcesQuery.isLoading}
        onClose={() => setResourceDialogOpen(false)}
        onAdd={addStoredResource}
      />
    </>
  );
}
