import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceCanvasDraft } from "./workspace-canvas-draft";
import type {
  FlushDraft,
  PersistDraft,
  UseWorkspaceCanvasOptions,
  WorkspaceCanvasRemoteHead,
} from "./workspace-canvas-lifecycle";
import type {
  CardCanvasSaveState,
  CardCanvasScene,
  NormalizedCardCanvas,
} from "~/views/card/components/card-canvas-types";
import { api } from "~/utils/api";
import {
  CARD_CANVAS_LOCAL_SAVE_DELAY,
  CARD_CANVAS_SERVER_SAVE_DELAY,
} from "~/views/card/components/card-canvas-types";
import {
  CardCanvasNormalizationError,
  CardCanvasNormalizer,
} from "~/views/card/components/card-canvas-worker-client";
import {
  claimWorkspaceCanvasDraft,
  clearWorkspaceCanvasDrafts,
  getWorkspaceCanvasDraftKey,
  resolveWorkspaceCanvasDraft,
  writeWorkspaceCanvasDraft,
} from "./workspace-canvas-draft";
import {
  canInitializeWorkspaceCanvas,
  canPersistWorkspaceCanvasDraft,
  createWorkspaceCanvasDraftGeneration,
  EMPTY_WORKSPACE_CANVAS_SCENE,
  getWorkspaceCanvasBlockingError,
  getWorkspaceCanvasChangedAt,
  getWorkspaceCanvasInitialOnline,
  getWorkspaceCanvasReconnectAction,
  preserveWorkspaceCanvasOnUnmount,
  replaceWorkspaceCanvasWithRemote,
} from "./workspace-canvas-lifecycle";

export function useWorkspaceCanvas({
  workspacePublicId,
  userId,
  canEdit,
}: UseWorkspaceCanvasOptions) {
  const initialOnline = getWorkspaceCanvasInitialOnline();
  const [draftGeneration] = useState(createWorkspaceCanvasDraftGeneration);
  const normalizerRef = useRef<CardCanvasNormalizer | null>(null);
  if (!normalizerRef.current && typeof window !== "undefined") {
    normalizerRef.current = new CardCanvasNormalizer();
  }
  const [scene, setScene] = useState<CardCanvasScene | null>(null);
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [saveState, setSaveState] = useState<CardCanvasSaveState>("loading");
  const [isOnline, setIsOnline] = useState(initialOnline);
  const [isDirty, setIsDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const [conflictRemoteVersion, setConflictRemoteVersion] = useState<
    number | null
  >(null);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const initializedWorkspaceRef = useRef<string | null>(null);
  const offlineDraftWorkspaceRef = useRef<string | null>(null);
  const remoteHeadWorkspaceRef = useRef<string | null>(null);
  const activeWorkspaceRef = useRef(workspacePublicId);
  activeWorkspaceRef.current = workspacePublicId;
  const mountedRef = useRef(true);
  const currentSceneRef = useRef<CardCanvasScene>(EMPTY_WORKSPACE_CANVAS_SCENE);
  const currentChangedAtRef = useRef(Date.now());
  const currentSequenceRef = useRef(0);
  const latestNormalizedRef = useRef<NormalizedCardCanvas | null>(null);
  const versionRef = useRef(0);
  const remoteHashRef = useRef<string | null>(null);
  const baselineHashRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const onlineRef = useRef(initialOnline);
  const dirtyRef = useRef(false);
  const draftStorageFailedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const saveSettledRef = useRef<Promise<void>>(Promise.resolve());
  const resolveSaveSettledRef = useRef<(() => void) | null>(null);
  const pendingFlushRef = useRef(false);
  const persistOnUnmountRef = useRef<PersistDraft>(() => Promise.resolve(null));
  const flushOnUnmountRef = useRef<FlushDraft>(() => Promise.resolve());
  const canFlushOnUnmountRef = useRef<() => boolean>(() => false);
  const localTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasQuery = api.workspaceCanvas.get.useQuery(
    { workspacePublicId },
    { enabled: workspacePublicId.length >= 12, retry: 1 },
  );
  const saveMutation = api.workspaceCanvas.save.useMutation();
  const effectiveCanEdit =
    canEdit && canvasQuery.data?.viewModeEnabled !== true;

  const updateMountedState = useCallback(
    (update: () => void) => {
      if (
        mountedRef.current &&
        activeWorkspaceRef.current === workspacePublicId
      ) {
        update();
      }
    },
    [workspacePublicId],
  );

  const clearTimers = useCallback(() => {
    if (localTimerRef.current) clearTimeout(localTimerRef.current);
    if (serverTimerRef.current) clearTimeout(serverTimerRef.current);
    localTimerRef.current = null;
    serverTimerRef.current = null;
  }, []);

  const normalizeCurrentScene = useCallback(async () => {
    const normalizer = normalizerRef.current;
    if (!normalizer) return null;
    const sequence = currentSequenceRef.current;
    try {
      const normalized = await normalizer.normalize(currentSceneRef.current);
      if (sequence === currentSequenceRef.current) {
        latestNormalizedRef.current = normalized;
        updateMountedState(() => setValidationError(null));
      }
      return { normalized, sequence };
    } catch (error) {
      if (sequence === currentSequenceRef.current) {
        updateMountedState(() => {
          setSaveState("invalid");
          setValidationError(
            error instanceof CardCanvasNormalizationError
              ? error.code
              : "NORMALIZATION_FAILED",
          );
        });
      }
      return null;
    }
  }, [updateMountedState]);

  const writeLocalDraft = useCallback(
    async (
      normalized: NormalizedCardCanvas,
      updatedAt: number,
      synced = false,
    ) => {
      if (!userId) return false;
      try {
        await writeWorkspaceCanvasDraft({
          key: getWorkspaceCanvasDraftKey(userId, workspacePublicId),
          workspacePublicId,
          userId,
          baseVersion: versionRef.current,
          baseHash: remoteHashRef.current,
          hash: normalized.hash,
          scene: normalized.scene,
          bytes: normalized.bytes,
          elementCount: normalized.elementCount,
          updatedAt,
          generation: draftGeneration,
          synced,
        });
        draftStorageFailedRef.current = false;
        return true;
      } catch {
        draftStorageFailedRef.current = true;
        return false;
      }
    },
    [draftGeneration, userId, workspacePublicId],
  );

  const persistLatestDraft = useCallback(async () => {
    if (
      !canPersistWorkspaceCanvasDraft(
        userId,
        effectiveCanEdit,
        dirtyRef.current,
      )
    )
      return null;
    const result = await normalizeCurrentScene();
    if (!result) return null;
    if (result.sequence !== currentSequenceRef.current) {
      return {
        normalized: result.normalized,
        localPersisted: false,
        isCurrent: false,
      };
    }
    const { normalized } = result;
    const updatedAt = currentChangedAtRef.current;
    if (!conflictRef.current && normalized.hash === baselineHashRef.current) {
      const persisted = await writeLocalDraft(normalized, updatedAt, true);
      if (result.sequence !== currentSequenceRef.current) {
        return { normalized, localPersisted: persisted, isCurrent: false };
      }
      dirtyRef.current = false;
      updateMountedState(() => {
        setIsDirty(false);
        setSaveState(persisted ? "saved" : "error");
      });
      return { normalized, localPersisted: persisted, isCurrent: true };
    }
    const persisted = await writeLocalDraft(normalized, updatedAt);
    if (result.sequence !== currentSequenceRef.current) {
      return { normalized, localPersisted: persisted, isCurrent: false };
    }
    dirtyRef.current = true;
    updateMountedState(() => {
      setIsDirty(true);
      setSaveState(
        conflictRef.current
          ? "conflict"
          : !persisted
            ? "error"
            : onlineRef.current
              ? "local"
              : "offline",
      );
    });
    return { normalized, localPersisted: persisted, isCurrent: true };
  }, [
    effectiveCanEdit,
    normalizeCurrentScene,
    updateMountedState,
    userId,
    writeLocalDraft,
  ]);
  persistOnUnmountRef.current = () =>
    dirtyRef.current ? persistLatestDraft() : Promise.resolve(null);

  const flushServerRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const flushServer = useCallback(async () => {
    if (
      !effectiveCanEdit ||
      !userId ||
      conflictRef.current ||
      !onlineRef.current
    ) {
      return;
    }
    if (saveInFlightRef.current) {
      pendingFlushRef.current = true;
      return;
    }
    const persistence = await persistLatestDraft();
    if (persistence && !persistence.isCurrent) {
      pendingFlushRef.current = true;
      return;
    }
    const normalized = persistence?.normalized;
    if (!normalized || normalized.hash === baselineHashRef.current) {
      return;
    }

    saveInFlightRef.current = true;
    saveSettledRef.current = new Promise<void>((resolve) => {
      resolveSaveSettledRef.current = resolve;
    });
    pendingFlushRef.current = false;
    updateMountedState(() => setSaveState("saving"));
    try {
      const result = await saveMutation.mutateAsync({
        workspacePublicId,
        expectedVersion: versionRef.current,
        scene: normalized.scene,
      });
      if (result.status === "conflict") {
        conflictRef.current = true;
        updateMountedState(() => {
          setConflictRemoteVersion(result.remoteVersion);
          setSaveState("conflict");
        });
        return;
      }
      versionRef.current = result.version;
      remoteHashRef.current = result.hash;
      baselineHashRef.current = result.hash;
      updateMountedState(() => setVersion(result.version));
      const latestPersistence = await persistLatestDraft();
      if (
        !latestPersistence ||
        !latestPersistence.isCurrent ||
        latestPersistence.normalized.hash !== result.hash
      ) {
        pendingFlushRef.current = true;
      }
    } catch {
      updateMountedState(() => setSaveState("error"));
    } finally {
      saveInFlightRef.current = false;
      resolveSaveSettledRef.current?.();
      resolveSaveSettledRef.current = null;
      if (
        pendingFlushRef.current &&
        !conflictRef.current &&
        mountedRef.current
      ) {
        pendingFlushRef.current = false;
        window.setTimeout(() => void flushServerRef.current(), 0);
      }
    }
  }, [
    effectiveCanEdit,
    persistLatestDraft,
    saveMutation,
    updateMountedState,
    userId,
    workspacePublicId,
  ]);
  flushServerRef.current = flushServer;

  const flushOnUnmount = useCallback(
    async (normalized: NormalizedCardCanvas) => {
      if (saveInFlightRef.current) await saveSettledRef.current;
      if (
        conflictRef.current ||
        !onlineRef.current ||
        remoteHeadWorkspaceRef.current !== workspacePublicId ||
        normalized.hash === baselineHashRef.current
      ) {
        return;
      }
      try {
        const result = await saveMutation.mutateAsync({
          workspacePublicId,
          expectedVersion: versionRef.current,
          scene: normalized.scene,
        });
        if (result.status === "conflict") {
          conflictRef.current = true;
          return;
        }
        versionRef.current = result.version;
        remoteHashRef.current = result.hash;
        baselineHashRef.current = result.hash;
        dirtyRef.current = false;
        await writeLocalDraft(normalized, currentChangedAtRef.current, true);
      } catch {
        return;
      }
    },
    [saveMutation, workspacePublicId, writeLocalDraft],
  );
  flushOnUnmountRef.current = flushOnUnmount;
  canFlushOnUnmountRef.current = () =>
    effectiveCanEdit &&
    Boolean(userId) &&
    onlineRef.current &&
    !conflictRef.current &&
    remoteHeadWorkspaceRef.current === workspacePublicId;

  const applyRemoteHead = useCallback(
    async (
      head: WorkspaceCanvasRemoteHead,
      allowDraft: boolean,
      draftOverride?: WorkspaceCanvasDraft | null,
    ) => {
      const remoteScene = (head.scene ??
        EMPTY_WORKSPACE_CANVAS_SCENE) as CardCanvasScene;
      const normalizer = normalizerRef.current;
      if (!normalizer) return false;
      const remoteNormalized = await normalizer.normalize(remoteScene);
      if (activeWorkspaceRef.current !== workspacePublicId) return false;
      versionRef.current = head.version;
      remoteHashRef.current = head.hash;
      baselineHashRef.current = head.hash ?? remoteNormalized.hash;
      remoteHeadWorkspaceRef.current = workspacePublicId;
      updateMountedState(() => {
        setVersion(head.version);
        setConflictRemoteVersion(null);
        setValidationError(null);
      });
      conflictRef.current = false;

      let draft: WorkspaceCanvasDraft | null = draftOverride ?? null;
      if (
        draftOverride === undefined &&
        allowDraft &&
        effectiveCanEdit &&
        userId
      ) {
        try {
          draft = await claimWorkspaceCanvasDraft(userId, workspacePublicId);
          draftStorageFailedRef.current = false;
        } catch {
          draftStorageFailedRef.current = true;
        }
      }
      if (activeWorkspaceRef.current !== workspacePublicId) return false;
      const resolution = resolveWorkspaceCanvasDraft(
        draft,
        head.version,
        head.hash,
      );
      const nextScene =
        resolution.kind === "remote" ? remoteScene : resolution.draft.scene;
      currentSceneRef.current = nextScene;
      currentChangedAtRef.current =
        resolution.kind === "remote" ? Date.now() : resolution.draft.updatedAt;
      currentSequenceRef.current += 1;
      latestNormalizedRef.current =
        resolution.kind === "remote"
          ? remoteNormalized
          : {
              requestId: 0,
              scene: resolution.draft.scene,
              serialized: "",
              hash: resolution.draft.hash,
              bytes: resolution.draft.bytes,
              elementCount: resolution.draft.elementCount,
              errors: [],
            };
      updateMountedState(() => {
        setScene(nextScene);
        setSceneEpoch((current) => current + 1);
      });
      if (resolution.kind === "conflict") {
        conflictRef.current = true;
        dirtyRef.current = true;
        updateMountedState(() => {
          setConflictRemoteVersion(head.version);
          setIsDirty(true);
          setSaveState("conflict");
        });
      } else if (resolution.kind === "draft") {
        dirtyRef.current = true;
        updateMountedState(() => {
          setIsDirty(true);
          setSaveState(onlineRef.current ? "local" : "offline");
        });
        if (onlineRef.current && mountedRef.current) {
          serverTimerRef.current = setTimeout(
            () => void flushServerRef.current(),
            CARD_CANVAS_SERVER_SAVE_DELAY,
          );
        }
      } else {
        dirtyRef.current = false;
        updateMountedState(() => {
          setIsDirty(false);
          setSaveState("saved");
        });
      }
      return true;
    },
    [effectiveCanEdit, updateMountedState, userId, workspacePublicId],
  );

  const applyVerifiedRemoteHead = useCallback(
    async (head: WorkspaceCanvasRemoteHead) => {
      let draftOverride: WorkspaceCanvasDraft | undefined;
      if (
        dirtyRef.current &&
        remoteHeadWorkspaceRef.current !== workspacePublicId &&
        effectiveCanEdit &&
        userId
      ) {
        const persistence = await persistLatestDraft();
        if (
          persistence?.isCurrent &&
          persistence.normalized.hash !== baselineHashRef.current
        ) {
          draftOverride = {
            key: getWorkspaceCanvasDraftKey(userId, workspacePublicId),
            workspacePublicId,
            userId,
            baseVersion: versionRef.current,
            baseHash: remoteHashRef.current,
            hash: persistence.normalized.hash,
            scene: persistence.normalized.scene,
            bytes: persistence.normalized.bytes,
            elementCount: persistence.normalized.elementCount,
            updatedAt: currentChangedAtRef.current,
            generation: draftGeneration,
          };
        }
      }
      await applyRemoteHead(head, true, draftOverride);
    },
    [
      applyRemoteHead,
      draftGeneration,
      effectiveCanEdit,
      persistLatestDraft,
      userId,
      workspacePublicId,
    ],
  );

  const loadOfflineDraft = useCallback(async () => {
    if (!effectiveCanEdit || !userId) return;
    try {
      const draft = await claimWorkspaceCanvasDraft(userId, workspacePublicId);
      if (
        activeWorkspaceRef.current !== workspacePublicId ||
        initializedWorkspaceRef.current === workspacePublicId ||
        remoteHeadWorkspaceRef.current === workspacePublicId
      ) {
        return;
      }
      draftStorageFailedRef.current = false;
      const nextScene = draft?.scene ?? EMPTY_WORKSPACE_CANVAS_SCENE;
      versionRef.current = draft?.baseVersion ?? 0;
      remoteHashRef.current = draft?.baseHash ?? null;
      baselineHashRef.current = draft?.baseHash ?? null;
      conflictRef.current = false;
      currentSceneRef.current = nextScene;
      currentChangedAtRef.current = draft?.updatedAt ?? Date.now();
      currentSequenceRef.current += 1;
      latestNormalizedRef.current = draft
        ? {
            requestId: 0,
            scene: draft.scene,
            serialized: "",
            hash: draft.hash,
            bytes: draft.bytes,
            elementCount: draft.elementCount,
            errors: [],
          }
        : null;
      const hasLocalChanges = draft !== null && draft.synced !== true;
      dirtyRef.current = hasLocalChanges;
      updateMountedState(() => {
        setScene(nextScene);
        setSceneEpoch((current) => current + 1);
        setVersion(draft?.baseVersion ?? 0);
        setConflictRemoteVersion(null);
        setValidationError(null);
        setIsDirty(hasLocalChanges);
        setSaveState("offline");
      });
    } catch {
      draftStorageFailedRef.current = true;
      updateMountedState(() => setSaveState("error"));
    }
  }, [effectiveCanEdit, updateMountedState, userId, workspacePublicId]);

  useEffect(() => {
    initializedWorkspaceRef.current = null;
    offlineDraftWorkspaceRef.current = null;
    remoteHeadWorkspaceRef.current = null;
    conflictRef.current = false;
    dirtyRef.current = false;
    draftStorageFailedRef.current = false;
    versionRef.current = 0;
    remoteHashRef.current = null;
    baselineHashRef.current = null;
    currentSceneRef.current = EMPTY_WORKSPACE_CANVAS_SCENE;
    currentChangedAtRef.current = Date.now();
    currentSequenceRef.current += 1;
    setScene(null);
    setIsDirty(false);
    setConflictRemoteVersion(null);
    setSaveState("loading");
    clearTimers();
  }, [clearTimers, workspacePublicId]);

  useEffect(() => {
    if (
      !canvasQuery.data ||
      initializedWorkspaceRef.current === workspacePublicId ||
      !canInitializeWorkspaceCanvas(effectiveCanEdit, userId)
    ) {
      return;
    }
    initializedWorkspaceRef.current = workspacePublicId;
    void applyVerifiedRemoteHead(canvasQuery.data).catch(() => {
      initializedWorkspaceRef.current = null;
      updateMountedState(() => setSaveState("error"));
    });
  }, [
    applyVerifiedRemoteHead,
    canvasQuery.data,
    effectiveCanEdit,
    updateMountedState,
    userId,
    workspacePublicId,
  ]);

  useEffect(() => {
    if (
      canvasQuery.data ||
      initializedWorkspaceRef.current === workspacePublicId ||
      offlineDraftWorkspaceRef.current === workspacePublicId ||
      (!canvasQuery.error && isOnline)
    ) {
      return;
    }
    offlineDraftWorkspaceRef.current = workspacePublicId;
    void loadOfflineDraft();
  }, [
    canvasQuery.data,
    canvasQuery.error,
    isOnline,
    loadOfflineDraft,
    workspacePublicId,
  ]);

  const refreshVerifiedRemoteHead = useCallback(async () => {
    if (initializedWorkspaceRef.current === workspacePublicId) return;
    initializedWorkspaceRef.current = workspacePublicId;
    clearTimers();
    try {
      const result = await canvasQuery.refetch();
      if (!result.data) throw new Error("CANVAS_NOT_FOUND");
      await applyVerifiedRemoteHead(result.data);
    } catch {
      initializedWorkspaceRef.current = null;
      updateMountedState(() =>
        setSaveState(onlineRef.current ? "error" : "offline"),
      );
    }
  }, [
    applyVerifiedRemoteHead,
    canvasQuery,
    clearTimers,
    updateMountedState,
    workspacePublicId,
  ]);

  useEffect(() => {
    const updateOnlineState = () => {
      const nextOnline = navigator.onLine;
      const wasOnline = onlineRef.current;
      onlineRef.current = nextOnline;
      setIsOnline(nextOnline);
      const reconnectAction = getWorkspaceCanvasReconnectAction({
        remoteHeadVerified:
          remoteHeadWorkspaceRef.current === workspacePublicId,
        isDirty: dirtyRef.current,
        hasConflict: conflictRef.current,
      });
      if (!nextOnline && dirtyRef.current) {
        setSaveState(draftStorageFailedRef.current ? "error" : "offline");
      } else if (
        nextOnline &&
        !wasOnline &&
        reconnectAction === "refresh-head"
      ) {
        void refreshVerifiedRemoteHead();
      } else if (nextOnline && reconnectAction === "flush") {
        if (serverTimerRef.current) clearTimeout(serverTimerRef.current);
        serverTimerRef.current = setTimeout(
          () => void flushServerRef.current(),
          CARD_CANVAS_SERVER_SAVE_DELAY,
        );
      }
    };
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, [refreshVerifiedRemoteHead, workspacePublicId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
      const normalizer = normalizerRef.current;
      void preserveWorkspaceCanvasOnUnmount({
        persistDraft: () => persistOnUnmountRef.current(),
        canFlushServer: () => canFlushOnUnmountRef.current(),
        flushServer: (normalized) => flushOnUnmountRef.current(normalized),
        dispose: () => {
          if (mountedRef.current) return;
          if (normalizerRef.current === normalizer) {
            normalizerRef.current = null;
          }
          normalizer?.dispose();
        },
      });
    };
  }, [clearTimers]);

  const onSceneChange = useCallback(
    (nextScene: CardCanvasScene) => {
      if (!effectiveCanEdit || scene === null) return;
      currentSceneRef.current = nextScene;
      currentChangedAtRef.current = getWorkspaceCanvasChangedAt(
        currentChangedAtRef.current,
      );
      currentSequenceRef.current += 1;
      dirtyRef.current = true;
      setIsDirty(true);
      setSaveState(
        conflictRef.current
          ? "conflict"
          : onlineRef.current
            ? "local"
            : "offline",
      );
      if (localTimerRef.current) clearTimeout(localTimerRef.current);
      if (serverTimerRef.current) clearTimeout(serverTimerRef.current);
      localTimerRef.current = setTimeout(
        () => void persistLatestDraft(),
        CARD_CANVAS_LOCAL_SAVE_DELAY,
      );
      if (!conflictRef.current) {
        serverTimerRef.current = setTimeout(
          () => void flushServerRef.current(),
          CARD_CANVAS_SERVER_SAVE_DELAY,
        );
      }
    },
    [effectiveCanEdit, persistLatestDraft, scene],
  );

  const loadRemoteVersion = useCallback(async () => {
    updateMountedState(() => setIsLoadingRemote(true));
    clearTimers();
    try {
      const result = await canvasQuery.refetch();
      if (!result.data) throw new Error("CANVAS_NOT_FOUND");
      const replacement = await replaceWorkspaceCanvasWithRemote({
        applyRemote: () => applyRemoteHead(result.data, false, null),
        discardLocalDraft: () =>
          userId
            ? clearWorkspaceCanvasDrafts(userId, workspacePublicId)
            : Promise.resolve(),
        persistRemoteDraft: () => {
          const remoteNormalized = latestNormalizedRef.current;
          return remoteNormalized
            ? writeLocalDraft(
                remoteNormalized,
                currentChangedAtRef.current,
                true,
              )
            : Promise.resolve(false);
        },
      });
      if (replacement === "not-applied") return null;
      initializedWorkspaceRef.current = workspacePublicId;
      draftStorageFailedRef.current = replacement !== "persisted";
      if (draftStorageFailedRef.current) {
        updateMountedState(() => setSaveState("error"));
      }
      return result.data;
    } finally {
      updateMountedState(() => setIsLoadingRemote(false));
    }
  }, [
    applyRemoteHead,
    canvasQuery,
    clearTimers,
    updateMountedState,
    userId,
    writeLocalDraft,
    workspacePublicId,
  ]);

  const reportConflict = useCallback(
    (remoteVersion: number) => {
      clearTimers();
      conflictRef.current = true;
      dirtyRef.current = true;
      setConflictRemoteVersion(remoteVersion);
      setIsDirty(true);
      setSaveState("conflict");
    },
    [clearTimers],
  );

  const retrySave = useCallback(() => {
    if (serverTimerRef.current) clearTimeout(serverTimerRef.current);
    serverTimerRef.current = null;
    void flushServerRef.current();
  }, []);

  return {
    scene,
    sceneEpoch,
    version,
    saveState,
    isOnline,
    isDirty,
    validationError,
    conflictRemoteVersion,
    isLoadingRemote,
    viewModeEnabled: !effectiveCanEdit,
    isLoading: scene === null,
    error: getWorkspaceCanvasBlockingError(scene, canvasQuery.error),
    onSceneChange,
    loadRemoteVersion,
    reportConflict,
    retrySave,
    retryInitialLoad: refreshVerifiedRemoteHead,
  };
}
