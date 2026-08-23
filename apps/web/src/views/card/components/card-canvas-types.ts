import type {
  CardCanvasJson,
  CardCanvasSceneErrorCode,
  NormalizedCardCanvasAppState,
  NormalizedCardCanvasElement,
  NormalizedCardCanvasScene,
} from "@kan/shared";

export type CanvasJsonValue = CardCanvasJson;
export type CardCanvasElement = NormalizedCardCanvasElement;
export type CardCanvasAppState = NormalizedCardCanvasAppState;
export type CardCanvasScene = NormalizedCardCanvasScene;

export interface CardCanvasDraft {
  key: string;
  cardPublicId: string;
  userId: string;
  baseVersion: number;
  baseHash: string | null;
  hash: string;
  scene: CardCanvasScene;
  bytes: number;
  elementCount: number;
  updatedAt: number;
}

export interface NormalizedCardCanvas {
  requestId: number;
  scene: CardCanvasScene;
  serialized: string;
  hash: string;
  bytes: number;
  elementCount: number;
  errors: CardCanvasValidationError[];
}

export type CardCanvasValidationError = CardCanvasSceneErrorCode;

export type CardCanvasSaveState =
  | "loading"
  | "saved"
  | "saving"
  | "local"
  | "offline"
  | "conflict"
  | "invalid"
  | "error";

export interface CardCanvasFrameView {
  publicId: string;
  elementId: string;
  name: string;
  present: boolean;
  subtask: {
    publicId: string;
    title: string;
    stageStatus: "planned" | "inProgress" | "blocked" | "done";
    checklist: {
      total: number;
      completed: number;
      progressPercent: number;
    };
  } | null;
}

export interface CardCanvasRevisionView {
  publicId: string;
  version: number;
  kind: "automatic" | "preRestore";
  bytes: number;
  elementCount: number;
  createdAt: Date;
}

export interface CardCanvasSubtaskFields {
  title: string;
  description?: string;
  priority?: "none" | "low" | "medium" | "high" | "urgent";
  dueDate?: Date;
  ownerPublicId?: string;
}

export interface CardCanvasWorkerRequest {
  requestId: number;
  scene: CardCanvasScene;
}

export type CardCanvasWorkerResponse =
  | NormalizedCardCanvas
  | {
      requestId: number;
      error: CardCanvasSceneErrorCode | "NORMALIZATION_FAILED";
    };

export const CARD_CANVAS_LOCAL_SAVE_DELAY = 250;
export const CARD_CANVAS_SERVER_SAVE_DELAY = 1_750;
