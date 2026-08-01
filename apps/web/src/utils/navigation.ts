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

export const buildBoardPath = (boardPublicId: string) =>
  `${BOARDS_PATH}/${boardPublicId}`;

export const isBoardsPath = (pathname: string) =>
  pathname === BOARDS_PATH || pathname.startsWith(`${BOARDS_PATH}/`);
