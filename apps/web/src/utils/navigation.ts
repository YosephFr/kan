export const APP_HOME_PATH = "/pulse";
export const BOARDS_PATH = "/boards";

export const PRIMARY_NAVIGATION_ORDER = [
  "dashboard",
  "boards",
  "templates",
  "members",
  "settings",
] as const;

export type PrimaryNavigationKey = (typeof PRIMARY_NAVIGATION_ORDER)[number];

export type PulseDetailMetric = "advanced" | "delivered" | "stalled" | "open";

export const buildBoardPath = (boardPublicId: string) =>
  `${BOARDS_PATH}/${boardPublicId}`;

export const isBoardsPath = (pathname: string) =>
  pathname === BOARDS_PATH || pathname.startsWith(`${BOARDS_PATH}/`);

export const buildPulseDetailPath = ({
  metric,
  period,
  workspacePublicId,
  memberPublicId,
}: {
  metric: PulseDetailMetric;
  period: "week" | "month";
  workspacePublicId?: string;
  memberPublicId?: string;
}) => {
  const search = new URLSearchParams({ metric, period });
  if (workspacePublicId) search.set("workspace", workspacePublicId);
  if (memberPublicId) search.set("member", memberPublicId);
  return `${APP_HOME_PATH}/details?${search.toString()}`;
};
