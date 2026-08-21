import type { ListStatus } from "@kan/db/schema";

export const deriveCardLifecycle = (args: {
  currentStatus?: ListStatus | null;
  destinationStatus: ListStatus | null;
  startedAt: Date | null;
  completedAt?: Date | null;
  movedAt: Date;
}) => ({
  startedAt:
    args.destinationStatus === "inProgress" && !args.startedAt
      ? args.movedAt
      : args.startedAt,
  completedAt:
    args.destinationStatus === "done"
      ? args.currentStatus === "done"
        ? (args.completedAt ?? null)
        : args.movedAt
      : null,
});
