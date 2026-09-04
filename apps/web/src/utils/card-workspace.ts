export const cardWorkspaceViews = [
  "summary",
  "subtasks",
  "visualWall",
  "files",
] as const;

export type CardWorkspaceView = (typeof cardWorkspaceViews)[number];

const cardWorkspaceQueryValues: Record<CardWorkspaceView, string> = {
  summary: "resumen",
  subtasks: "subtareas",
  visualWall: "muro-visual",
  files: "archivos",
};

const firstQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const getCardWorkspaceView = (
  value: string | string[] | undefined,
  legacyValue?: string | string[],
): CardWorkspaceView => {
  const candidate = firstQueryValue(value) ?? firstQueryValue(legacyValue);

  if (candidate === "pizarra" || candidate === "whiteboard") {
    return "visualWall";
  }

  const canonicalView = cardWorkspaceViews.find(
    (view) => cardWorkspaceQueryValues[view] === candidate,
  );

  if (canonicalView) return canonicalView;

  return cardWorkspaceViews.includes(candidate as CardWorkspaceView)
    ? (candidate as CardWorkspaceView)
    : "summary";
};

export const getCardWorkspaceTargetView = ({
  value,
  legacyValue,
  subtask,
  resource,
  frame,
}: {
  value?: string | string[];
  legacyValue?: string | string[];
  subtask?: string | string[];
  resource?: string | string[];
  frame?: string | string[];
}): CardWorkspaceView | null => {
  if (firstQueryValue(subtask)) return "subtasks";
  if (firstQueryValue(frame)) return "visualWall";
  if (firstQueryValue(resource)) return "files";
  if (value !== undefined || legacyValue !== undefined) {
    return getCardWorkspaceView(value, legacyValue);
  }
  return null;
};

export const getCardWorkspaceQueryValue = (view: CardWorkspaceView) =>
  cardWorkspaceQueryValues[view];

export const getCardWorkspaceNavigationQuery = (
  query: Record<string, string | string[] | undefined>,
  view: CardWorkspaceView,
  target?: { subtask?: string; resource?: string },
) => {
  const nextQuery: Record<string, string | string[] | undefined> = {
    ...query,
    vista: getCardWorkspaceQueryValue(view),
  };
  delete nextQuery.view;
  delete nextQuery.subtask;
  delete nextQuery.recurso;
  delete nextQuery.frame;

  if (view === "subtasks" && target?.subtask) {
    nextQuery.subtask = target.subtask;
  }
  if (view === "files" && target?.resource) {
    nextQuery.recurso = target.resource;
  }
  return nextQuery;
};

export const getNextTabIndex = (
  currentIndex: number,
  tabCount: number,
  key: string,
) => {
  if (tabCount === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  return null;
};

export const toLocalDateTimeInput = (value: Date | null | undefined) => {
  if (!value) return "";

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
};

export const fromLocalDateTimeInput = (value: string) => {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isCardWorkspaceAligned = (
  activeWorkspacePublicId: string,
  cardWorkspacePublicId: string | null | undefined,
) =>
  cardWorkspacePublicId !== undefined &&
  cardWorkspacePublicId !== null &&
  activeWorkspacePublicId === cardWorkspacePublicId;

export const isOpenSubtasksConfirmationError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    message?: unknown;
    data?: { code?: unknown } | null;
  };

  return (
    candidate.data?.code === "PRECONDITION_FAILED" &&
    candidate.message === "OPEN_SUBTASKS_CONFIRMATION_REQUIRED"
  );
};

export const isPublicVisibilityAcknowledgementError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    message?: unknown;
    data?: { code?: unknown } | null;
  };

  return (
    candidate.data?.code === "PRECONDITION_FAILED" &&
    candidate.message === "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED"
  );
};
