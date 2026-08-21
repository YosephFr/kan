export const cardWorkspaceViews = [
  "summary",
  "subtasks",
  "whiteboard",
  "files",
] as const;

export type CardWorkspaceView = (typeof cardWorkspaceViews)[number];

const cardWorkspaceQueryValues: Record<CardWorkspaceView, string> = {
  summary: "resumen",
  subtasks: "subtareas",
  whiteboard: "pizarra",
  files: "archivos",
};

const firstQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const getCardWorkspaceView = (
  value: string | string[] | undefined,
  legacyValue?: string | string[],
): CardWorkspaceView => {
  const candidate = firstQueryValue(value) ?? firstQueryValue(legacyValue);

  const canonicalView = cardWorkspaceViews.find(
    (view) => cardWorkspaceQueryValues[view] === candidate,
  );

  if (canonicalView) return canonicalView;

  return cardWorkspaceViews.includes(candidate as CardWorkspaceView)
    ? (candidate as CardWorkspaceView)
    : "summary";
};

export const getCardWorkspaceQueryValue = (view: CardWorkspaceView) =>
  cardWorkspaceQueryValues[view];

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
