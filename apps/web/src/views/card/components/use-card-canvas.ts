import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CardCanvasDraft,
  CardCanvasFrameView,
  CardCanvasSaveState,
  CardCanvasScene,
  NormalizedCardCanvas,
} from "./card-canvas-types";
import type { RouterOutputs } from "~/utils/api";
import { api } from "~/utils/api";
import {
  deleteCardCanvasDraft,
  getCardCanvasDraftKey,
  readCardCanvasDraft,
  resolveCardCanvasDraft,
  writeCardCanvasDraft,
} from "./card-canvas-draft";
import {
  CARD_CANVAS_LOCAL_SAVE_DELAY,
  CARD_CANVAS_SERVER_SAVE_DELAY,
} from "./card-canvas-types";
import {
  CardCanvasNormalizationError,
  CardCanvasNormalizer,
} from "./card-canvas-worker-client";

type CardCanvasHead = RouterOutputs["cardCanvas"]["get"];
type CardCanvasSaveResult = RouterOutputs["cardCanvas"]["save"];

const EMPTY_SCENE: CardCanvasScene = { elements: [], appState: {} };

interface UseCardCanvasOptions {
  cardPublicId: string;
  userId: string | null;
  canEdit: boolean;
}

export function useCardCanvas({
  cardPublicId,
  userId,
  canEdit,
}: UseCardCanvasOptions) {
  const normalizerRef = useRef<CardCanvasNormalizer | null>(null);
  if (!normalizerRef.current && typeof window !== "undefined") {
    normalizerRef.current = new CardCanvasNormalizer();
  }
  const [scene, setScene] = useState<CardCanvasScene | null>(null);
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [saveState, setSaveState] = useState<CardCanvasSaveState>("loading");
  const [isOnline, setIsOnline] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const [conflictRemoteVersion, setConflictRemoteVersion] = useState<
    number | null
  >(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const initializedCardRef = useRef<string | null>(null);
  const currentSceneRef = useRef<CardCanvasScene>(EMPTY_SCENE);
  const currentSequenceRef = useRef(0);
  const latestNormalizedRef = useRef<NormalizedCardCanvas | null>(null);
  const versionRef = useRef(0);
  const remoteHashRef = useRef<string | null>(null);
  const baselineHashRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const draftStorageFailedRef = useRef(false);
  const onlineRef = useRef(true);
  const saveInFlightRef = useRef(false);
  const pendingFlushRef = useRef(false);
  const localTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasQuery = api.cardCanvas.get.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12, retry: 1 },
  );
  const framesQuery = api.cardCanvas.listFrames.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12, retry: 1 },
  );
  const saveMutation = api.cardCanvas.save.useMutation();
  const effectiveCanEdit =
    canEdit && canvasQuery.data?.viewModeEnabled !== true;

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
        setValidationError(null);
      }
      return { normalized, sequence };
    } catch (error) {
      if (sequence === currentSequenceRef.current) {
        setSaveState("invalid");
        setValidationError(
          error instanceof CardCanvasNormalizationError
            ? error.code
            : "NORMALIZATION_FAILED",
        );
      }
      return null;
    }
  }, []);

  const removeLocalDraft = useCallback(async () => {
    if (!userId) return true;
    try {
      await deleteCardCanvasDraft(userId, cardPublicId);
      draftStorageFailedRef.current = false;
      return true;
    } catch {
      draftStorageFailedRef.current = true;
      return false;
    }
  }, [cardPublicId, userId]);

  const persistLatestDraft = useCallback(async () => {
    if (!effectiveCanEdit || !userId) return null;
    const result = await normalizeCurrentScene();
    if (!result || result.sequence !== currentSequenceRef.current) return null;
    const { normalized } = result;
    if (!conflictRef.current && normalized.hash === baselineHashRef.current) {
      const draftRemoved = await removeLocalDraft();
      setIsDirty(false);
      setSaveState(draftRemoved ? "saved" : "error");
      return normalized;
    }
    let draftPersisted = true;
    try {
      await writeCardCanvasDraft({
        key: getCardCanvasDraftKey(userId, cardPublicId),
        cardPublicId,
        userId,
        baseVersion: versionRef.current,
        baseHash: remoteHashRef.current,
        hash: normalized.hash,
        scene: normalized.scene,
        bytes: normalized.bytes,
        elementCount: normalized.elementCount,
        updatedAt: Date.now(),
      });
      draftStorageFailedRef.current = false;
    } catch {
      draftPersisted = false;
      draftStorageFailedRef.current = true;
    }
    setIsDirty(true);
    setSaveState(
      conflictRef.current
        ? "conflict"
        : !draftPersisted
          ? "error"
          : onlineRef.current
            ? "local"
            : "offline",
    );
    return normalized;
  }, [
    cardPublicId,
    effectiveCanEdit,
    normalizeCurrentScene,
    removeLocalDraft,
    userId,
  ]);

  const flushServerRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const flushServer = useCallback(async () => {
    if (
      !effectiveCanEdit ||
      !userId ||
      conflictRef.current ||
      !onlineRef.current
    ) {
      if (!onlineRef.current && isDirty) {
        setSaveState(draftStorageFailedRef.current ? "error" : "offline");
      }
      return;
    }
    if (saveInFlightRef.current) {
      pendingFlushRef.current = true;
      return;
    }
    const normalized = await persistLatestDraft();
    if (!normalized || normalized.hash === baselineHashRef.current) return;

    saveInFlightRef.current = true;
    pendingFlushRef.current = false;
    setSaveState("saving");
    const savingSequence = currentSequenceRef.current;
    try {
      const result = await saveMutation.mutateAsync({
        cardPublicId,
        expectedVersion: versionRef.current,
        scene: normalized.scene,
      });
      if (result.status === "conflict") {
        conflictRef.current = true;
        setConflictRemoteVersion(result.remoteVersion);
        setSaveState("conflict");
        return;
      }

      versionRef.current = result.version;
      remoteHashRef.current = result.hash;
      baselineHashRef.current = result.hash;
      setVersion(result.version);
      if (
        savingSequence === currentSequenceRef.current ||
        latestNormalizedRef.current?.hash === result.hash
      ) {
        await removeLocalDraft();
        setIsDirty(false);
        setSaveState("saved");
      } else {
        await persistLatestDraft();
        pendingFlushRef.current = true;
      }
    } catch {
      setSaveState("error");
    } finally {
      saveInFlightRef.current = false;
      if (pendingFlushRef.current && !conflictRef.current) {
        pendingFlushRef.current = false;
        window.setTimeout(() => void flushServerRef.current(), 0);
      }
    }
  }, [
    cardPublicId,
    effectiveCanEdit,
    isDirty,
    persistLatestDraft,
    removeLocalDraft,
    saveMutation,
    userId,
  ]);
  flushServerRef.current = flushServer;

  const applyRemoteHead = useCallback(
    async (head: CardCanvasHead, allowDraft: boolean) => {
      const remoteScene = (head.scene ?? EMPTY_SCENE) as CardCanvasScene;
      const normalizer = normalizerRef.current;
      if (!normalizer) return;
      const remoteNormalized = await normalizer.normalize(remoteScene);
      versionRef.current = head.version;
      remoteHashRef.current = head.hash;
      baselineHashRef.current = head.hash ?? remoteNormalized.hash;
      setVersion(head.version);
      setConflictRemoteVersion(null);
      setValidationError(null);
      conflictRef.current = false;

      let draft: CardCanvasDraft | null = null;
      if (allowDraft && effectiveCanEdit && userId) {
        try {
          draft = await readCardCanvasDraft(userId, cardPublicId);
          draftStorageFailedRef.current = false;
        } catch {
          draftStorageFailedRef.current = true;
        }
      }
      const resolution = resolveCardCanvasDraft(draft, head.version, head.hash);
      const nextScene =
        resolution.kind === "remote" ? remoteScene : resolution.draft.scene;
      currentSceneRef.current = nextScene;
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
      setScene(nextScene);
      setSceneEpoch((current) => current + 1);
      if (resolution.kind === "conflict") {
        conflictRef.current = true;
        setConflictRemoteVersion(head.version);
        setIsDirty(true);
        setSaveState("conflict");
      } else if (resolution.kind === "draft") {
        setIsDirty(true);
        setSaveState(onlineRef.current ? "local" : "offline");
        serverTimerRef.current = setTimeout(
          () => void flushServerRef.current(),
          CARD_CANVAS_SERVER_SAVE_DELAY,
        );
      } else {
        setIsDirty(false);
        setSaveState("saved");
      }
    },
    [cardPublicId, effectiveCanEdit, userId],
  );

  useEffect(() => {
    initializedCardRef.current = null;
    setScene(null);
    setSaveState("loading");
    clearTimers();
  }, [cardPublicId, clearTimers]);

  useEffect(() => {
    if (!canvasQuery.data || initializedCardRef.current === cardPublicId)
      return;
    initializedCardRef.current = cardPublicId;
    void applyRemoteHead(canvasQuery.data, true).catch(() => {
      initializedCardRef.current = null;
      setSaveState("error");
    });
  }, [applyRemoteHead, canvasQuery.data, cardPublicId]);

  useEffect(() => {
    const updateOnlineState = () => {
      const nextOnline = navigator.onLine;
      onlineRef.current = nextOnline;
      setIsOnline(nextOnline);
      if (!nextOnline && isDirty) {
        setSaveState(draftStorageFailedRef.current ? "error" : "offline");
      }
      if (nextOnline && isDirty && !conflictRef.current) {
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
  }, [isDirty]);

  useEffect(
    () => () => {
      clearTimers();
      normalizerRef.current?.dispose();
      normalizerRef.current = null;
    },
    [clearTimers],
  );

  const onSceneChange = useCallback(
    (nextScene: CardCanvasScene) => {
      if (!effectiveCanEdit || scene === null) return;
      currentSceneRef.current = nextScene;
      currentSequenceRef.current += 1;
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
    setIsLoadingRemote(true);
    clearTimers();
    try {
      const result = await canvasQuery.refetch();
      if (!result.data) throw new Error("CANVAS_NOT_FOUND");
      if (!(await removeLocalDraft())) {
        setSaveState(conflictRef.current ? "conflict" : "error");
        return;
      }
      await applyRemoteHead(result.data, false);
    } finally {
      setIsLoadingRemote(false);
    }
  }, [applyRemoteHead, canvasQuery, clearTimers, removeLocalDraft]);

  const reportConflict = useCallback(
    (remoteVersion: number) => {
      clearTimers();
      conflictRef.current = true;
      setConflictRemoteVersion(remoteVersion);
      setIsDirty(true);
      setSaveState("conflict");
    },
    [clearTimers],
  );

  const normalizeScene = useCallback(async (nextScene: CardCanvasScene) => {
    const normalizer = normalizerRef.current;
    if (!normalizer) throw new Error("NORMALIZER_NOT_READY");
    return normalizer.normalize(nextScene);
  }, []);

  const acceptExternalSave = useCallback(
    async (result: Exclude<CardCanvasSaveResult, { status: "conflict" }>) => {
      versionRef.current = result.version;
      remoteHashRef.current = result.hash;
      baselineHashRef.current = result.hash;
      setVersion(result.version);
      setIsDirty(false);
      setSaveState("saved");
      await removeLocalDraft();
    },
    [removeLocalDraft],
  );

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
    isLoading: canvasQuery.isLoading || scene === null,
    error: canvasQuery.error,
    frames: (framesQuery.data ?? []) as CardCanvasFrameView[],
    framesLoading: framesQuery.isLoading,
    onSceneChange,
    normalizeCurrentScene,
    normalizeScene,
    loadRemoteVersion,
    reportConflict,
    acceptExternalSave,
    refetchFrames: framesQuery.refetch,
    refetchHead: loadRemoteVersion,
  };
}
