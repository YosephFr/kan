const BOARD_PUBLIC_ID_PATTERN = /^[a-z0-9]{12}$/;

export const isBoardPublicId = (
  value: string | null | undefined,
): value is string =>
  typeof value === "string" && BOARD_PUBLIC_ID_PATTERN.test(value);

export const getBoardRoutePublicId = (value: string | string[] | undefined) => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isBoardPublicId(candidate) ? candidate : null;
};

export const keepCurrentBoardData = <T extends { publicId: string }>(
  previousBoard: T | undefined,
  boardPublicId: string | null,
) => (previousBoard?.publicId === boardPublicId ? previousBoard : undefined);
