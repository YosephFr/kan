import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES } from "@kan/shared";

import type { WorkspaceCanvasImageResource } from "./workspace-canvas-image-loader";
import { api } from "~/utils/api";
import {
  assertWorkspaceCanvasExportCapacity,
  chunkWorkspaceCanvasImagePublicIds,
  hydrateWorkspaceCanvasImageWithMetadataRefresh,
  loadWorkspaceCanvasImageFile,
  prioritizeWorkspaceCanvasImageMetadata,
  prioritizeWorkspaceCanvasImagePublicIds,
  runWorkspaceCanvasImageQueue,
} from "./workspace-canvas-image-loader";

interface WorkspaceCanvasImageLoadState {
  total: number;
  loaded: number;
  failed: number;
  loading: boolean;
}

const EMPTY_STATE: WorkspaceCanvasImageLoadState = {
  total: 0,
  loaded: 0,
  failed: 0,
  loading: false,
};

const createWorkspaceCanvasImageMetadataRequestQueue = () => {
  let tail = Promise.resolve();

  return <Result>(
    operation: () => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> => {
    const result = tail.then(() => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return operation();
    });
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
};

export function useWorkspaceCanvasImages({
  workspacePublicId,
  imagePublicIds,
  canvasApi,
}: {
  workspacePublicId: string;
  imagePublicIds: readonly string[];
  canvasApi: ExcalidrawImperativeAPI | null;
}) {
  const utils = api.useUtils();
  const [state, setState] =
    useState<WorkspaceCanvasImageLoadState>(EMPTY_STATE);
  const [storage, setStorage] = useState({
    usageBytes: 0,
    quotaBytes: MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
  });
  const [viewportEpoch, setViewportEpoch] = useState(0);
  const [retryEpoch, setRetryEpoch] = useState(0);
  const operationRef = useRef(0);
  const progressiveControllerRef = useRef<AbortController | null>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  const workspaceKeyRef = useRef<string | null>(null);
  const retryEpochRef = useRef(-1);
  const metadataRef = useRef(new Map<string, WorkspaceCanvasImageResource>());
  const failedRef = useRef(new Set<string>());
  const nearPublicIdsRef = useRef<string[]>([]);
  const nearKeyRef = useRef("");
  const metadataRequestQueueRef = useRef(
    createWorkspaceCanvasImageMetadataRequestQueue(),
  );
  const metadataRequestWorkspaceRef = useRef(workspacePublicId);
  const publicIds = useMemo(
    () => [...new Set(imagePublicIds)].sort(),
    [imagePublicIds],
  );
  const publicIdsKey = publicIds.join(",");

  const updateViewport = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      const next = prioritizeWorkspaceCanvasImagePublicIds({
        publicIds,
        elements,
        appState,
        includeFar: false,
      });
      const key = next.join(",");
      nearPublicIdsRef.current = next;
      if (key === nearKeyRef.current) return;
      nearKeyRef.current = key;
      setViewportEpoch((epoch) => epoch + 1);
    },
    [publicIds],
  );

  useEffect(() => {
    if (!canvasApi) return;
    updateViewport(canvasApi.getSceneElements(), canvasApi.getAppState());
  }, [canvasApi, publicIdsKey, updateViewport]);

  useEffect(
    () => () => {
      progressiveControllerRef.current?.abort();
      progressiveControllerRef.current = null;
      exportControllerRef.current?.abort();
      exportControllerRef.current = null;
    },
    [workspacePublicId],
  );

  useEffect(() => {
    operationRef.current += 1;
    const operation = operationRef.current;
    const abortController = new AbortController();
    progressiveControllerRef.current?.abort();
    progressiveControllerRef.current = abortController;
    const isCurrent = () =>
      operationRef.current === operation && !abortController.signal.aborted;
    if (metadataRequestWorkspaceRef.current !== workspacePublicId) {
      metadataRequestWorkspaceRef.current = workspacePublicId;
      metadataRequestQueueRef.current =
        createWorkspaceCanvasImageMetadataRequestQueue();
    }
    const metadataRequestQueue = metadataRequestQueueRef.current;

    if (!canvasApi || workspacePublicId.length !== 12) {
      workspaceKeyRef.current = workspacePublicId;
      metadataRef.current.clear();
      failedRef.current.clear();
      setState(EMPTY_STATE);
      setStorage({
        usageBytes: 0,
        quotaBytes: MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
      });
      return () => {
        abortController.abort();
        if (progressiveControllerRef.current === abortController) {
          progressiveControllerRef.current = null;
        }
      };
    }

    const workspaceChanged = workspaceKeyRef.current !== workspacePublicId;
    const retryChanged = retryEpochRef.current !== retryEpoch;
    workspaceKeyRef.current = workspacePublicId;
    retryEpochRef.current = retryEpoch;
    if (workspaceChanged) {
      metadataRef.current = new Map();
      failedRef.current = new Set();
      setStorage({
        usageBytes: 0,
        quotaBytes: MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
      });
    } else {
      const activePublicIds = new Set(publicIds);
      for (const publicId of metadataRef.current.keys()) {
        if (!activePublicIds.has(publicId))
          metadataRef.current.delete(publicId);
      }
      failedRef.current = new Set(
        [...failedRef.current].filter((publicId) =>
          activePublicIds.has(publicId),
        ),
      );
    }
    const hydratedCount = publicIds.filter((publicId) =>
      Boolean(canvasApi.getFiles()[publicId]),
    ).length;
    setState({
      total: publicIds.length,
      loaded: hydratedCount,
      failed: failedRef.current.size,
      loading: nearPublicIdsRef.current.some(
        (publicId) => !canvasApi.getFiles()[publicId],
      ),
    });

    void (async () => {
      const hydrateNearImages = async () => {
        const pendingPublicIds = nearPublicIdsRef.current.filter(
          (publicId) =>
            !canvasApi.getFiles()[publicId] &&
            !failedRef.current.has(publicId) &&
            metadataRef.current.has(publicId),
        );
        setState({
          total: publicIds.length,
          loaded: publicIds.filter((publicId) =>
            Boolean(canvasApi.getFiles()[publicId]),
          ).length,
          failed: failedRef.current.size,
          loading: pendingPublicIds.length > 0,
        });
        await runWorkspaceCanvasImageQueue({
          items: pendingPublicIds,
          signal: abortController.signal,
          worker: async (publicId, signal) => {
            if (canvasApi.getFiles()[publicId]) return;
            const resource = metadataRef.current.get(publicId);
            if (!resource) throw new Error("WORKSPACE_CANVAS_IMAGE_MISSING");
            const hydrated =
              await hydrateWorkspaceCanvasImageWithMetadataRefresh({
                api: canvasApi,
                resource,
                signal,
                refreshResource: async () => {
                  metadataRef.current.delete(publicId);
                  const refreshed = await metadataRequestQueue(
                    () =>
                      utils.workspaceCanvas.listImages.fetch(
                        {
                          workspacePublicId,
                          imagePublicIds: [publicId],
                        },
                        { trpc: { signal } },
                      ),
                    signal,
                  );
                  if (!isCurrent()) return undefined;
                  setStorage({
                    usageBytes: refreshed.usageBytes,
                    quotaBytes: refreshed.quotaBytes,
                  });
                  return refreshed.images[0] as
                    | WorkspaceCanvasImageResource
                    | undefined;
                },
              });
            metadataRef.current.set(publicId, hydrated.resource);
          },
          onSettled: (publicId, error) => {
            if (!isCurrent()) return;
            if (error) failedRef.current.add(publicId);
            setState({
              total: publicIds.length,
              loaded: publicIds.filter((id) => canvasApi.getFiles()[id]).length,
              failed: failedRef.current.size,
              loading: true,
            });
          },
        });
      };

      await hydrateNearImages();
      if (!isCurrent()) return;
      const missingMetadataPublicIds = publicIds.filter(
        (publicId) =>
          !failedRef.current.has(publicId) &&
          !metadataRef.current.has(publicId),
      );
      const orderedMetadataPublicIds = prioritizeWorkspaceCanvasImageMetadata({
        publicIds: missingMetadataPublicIds,
        nearPublicIds: nearPublicIdsRef.current,
      });
      const chunks =
        orderedMetadataPublicIds.length > 0
          ? chunkWorkspaceCanvasImagePublicIds(orderedMetadataPublicIds)
          : retryChanged || (workspaceChanged && publicIds.length === 0)
            ? [[]]
            : [];
      for (const chunk of chunks) {
        if (!isCurrent()) return;
        try {
          const result = await metadataRequestQueue(
            () =>
              utils.workspaceCanvas.listImages.fetch(
                {
                  workspacePublicId,
                  imagePublicIds: chunk,
                },
                { trpc: { signal: abortController.signal } },
              ),
            abortController.signal,
          );
          if (!isCurrent()) return;
          setStorage({
            usageBytes: result.usageBytes,
            quotaBytes: result.quotaBytes,
          });
          const returned = new Set<string>();
          for (const resource of result.images) {
            returned.add(resource.publicId);
            metadataRef.current.set(
              resource.publicId,
              resource as WorkspaceCanvasImageResource,
            );
          }
          for (const publicId of chunk) {
            if (!returned.has(publicId)) failedRef.current.add(publicId);
          }
        } catch {
          if (!isCurrent()) return;
          for (const publicId of chunk) failedRef.current.add(publicId);
        }
        await hydrateNearImages();
      }
      if (!isCurrent()) return;
      setState({
        total: publicIds.length,
        loaded: publicIds.filter((publicId) => canvasApi.getFiles()[publicId])
          .length,
        failed: failedRef.current.size,
        loading: false,
      });
    })();

    return () => {
      abortController.abort();
      if (progressiveControllerRef.current === abortController) {
        progressiveControllerRef.current = null;
      }
    };
  }, [
    canvasApi,
    publicIds,
    publicIdsKey,
    retryEpoch,
    utils,
    viewportEpoch,
    workspacePublicId,
  ]);

  const retryFailed = useCallback(() => {
    for (const publicId of failedRef.current) {
      metadataRef.current.delete(publicId);
    }
    failedRef.current.clear();
    setRetryEpoch((epoch) => epoch + 1);
  }, []);

  const withAllImages = useCallback(
    async <T>(
      callback: (files: BinaryFiles) => Promise<T>,
      requestedPublicIds: readonly string[] = publicIds,
    ) => {
      if (!canvasApi) throw new Error("WORKSPACE_CANVAS_IMAGE_API_UNAVAILABLE");
      const exportPublicIds = [
        ...new Set(
          requestedPublicIds.filter((publicId) => publicIds.includes(publicId)),
        ),
      ].sort();
      operationRef.current += 1;
      progressiveControllerRef.current?.abort();
      progressiveControllerRef.current = null;
      exportControllerRef.current?.abort();
      const abortController = new AbortController();
      exportControllerRef.current = abortController;
      const isCurrent = () =>
        !abortController.signal.aborted &&
        workspaceKeyRef.current === workspacePublicId;
      for (const publicId of exportPublicIds)
        failedRef.current.delete(publicId);
      setState({
        total: exportPublicIds.length,
        loaded: 0,
        failed: failedRef.current.size,
        loading: exportPublicIds.length > 0,
      });

      try {
        for (const chunk of chunkWorkspaceCanvasImagePublicIds(
          exportPublicIds,
        )) {
          if (!isCurrent()) throw new DOMException("Aborted", "AbortError");
          try {
            const result = await metadataRequestQueueRef.current(
              () =>
                utils.workspaceCanvas.listImages.fetch(
                  {
                    workspacePublicId,
                    imagePublicIds: chunk,
                  },
                  { trpc: { signal: abortController.signal } },
                ),
              abortController.signal,
            );
            if (!isCurrent()) throw new DOMException("Aborted", "AbortError");
            setStorage({
              usageBytes: result.usageBytes,
              quotaBytes: result.quotaBytes,
            });
            const returned = new Set<string>();
            for (const resource of result.images) {
              returned.add(resource.publicId);
              metadataRef.current.set(
                resource.publicId,
                resource as WorkspaceCanvasImageResource,
              );
            }
            for (const publicId of chunk) {
              if (!returned.has(publicId)) failedRef.current.add(publicId);
            }
          } catch (error) {
            if (!isCurrent()) throw error;
            for (const publicId of chunk) failedRef.current.add(publicId);
          }
        }

        const resources = exportPublicIds.flatMap((publicId) => {
          const resource = metadataRef.current.get(publicId);
          return resource && !failedRef.current.has(publicId) ? [resource] : [];
        });
        assertWorkspaceCanvasExportCapacity(resources);
        const files: BinaryFiles = {};
        let settled = 0;
        const result = await runWorkspaceCanvasImageQueue({
          items: resources,
          signal: abortController.signal,
          worker: async (resource, signal) => {
            const file = await loadWorkspaceCanvasImageFile({
              resource,
              signal,
            });
            files[file.id] = file;
          },
          onSettled: (resource, error) => {
            if (!isCurrent()) return;
            settled += 1;
            if (error) failedRef.current.add(resource.publicId);
            setState({
              total: exportPublicIds.length,
              loaded: settled,
              failed: failedRef.current.size,
              loading: true,
            });
          },
        });
        if (!isCurrent()) throw new DOMException("Aborted", "AbortError");
        if (
          resources.length !== exportPublicIds.length ||
          result.failed.length > 0 ||
          exportPublicIds.some((publicId) => failedRef.current.has(publicId))
        ) {
          throw new Error("WORKSPACE_CANVAS_IMAGE_LOAD_FAILED");
        }
        return await callback(files);
      } finally {
        if (exportControllerRef.current === abortController) {
          exportControllerRef.current = null;
        }
        if (isCurrent()) {
          setState({
            total: publicIds.length,
            loaded: publicIds.filter(
              (publicId) => canvasApi.getFiles()[publicId],
            ).length,
            failed: failedRef.current.size,
            loading: false,
          });
          setViewportEpoch((epoch) => epoch + 1);
        }
      }
    },
    [canvasApi, publicIds, utils.workspaceCanvas.listImages, workspacePublicId],
  );

  return {
    knownUsageBytes: storage.usageBytes,
    quotaBytes: storage.quotaBytes,
    total: state.total,
    loaded: state.loaded,
    failed: state.failed,
    isLoading: state.loading,
    imageLoadError: state.failed > 0,
    withAllImages,
    retryFailed,
    updateViewport,
  };
}
