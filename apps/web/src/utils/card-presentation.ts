export type CardPriority = "none" | "low" | "medium" | "high" | "urgent";

export const cardPriorityValues = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const satisfies readonly CardPriority[];

export function isCardPriority(value: string): value is CardPriority {
  return (cardPriorityValues as readonly string[]).includes(value);
}

export type ListStatus =
  | "planned"
  | "inProgress"
  | "blocked"
  | "done"
  | "other";

export interface ChecklistProgress {
  completed: number;
  total: number;
  percentage: number;
}

export type DeadlineState =
  | "onTrack"
  | "dueSoon"
  | "overdue"
  | "completedOnTime"
  | "completedLate";

export interface DeadlineProgress {
  percentage: number;
  state: DeadlineState;
}

interface Checklist {
  items: { completed: boolean }[];
}

interface DeadlineInput {
  startedAt?: Date | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  now?: Date;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function getChecklistProgress(
  checklists: Checklist[],
): ChecklistProgress | null {
  const total = checklists.reduce(
    (count, checklist) => count + checklist.items.length,
    0,
  );

  if (total === 0) return null;

  const completed = checklists.reduce(
    (count, checklist) =>
      count + checklist.items.filter((item) => item.completed).length,
    0,
  );

  return {
    completed,
    total,
    percentage: Math.round((completed / total) * 100),
  };
}

export function getDeadlineProgress({
  startedAt,
  dueDate,
  completedAt,
  now = new Date(),
}: DeadlineInput): DeadlineProgress | null {
  if (!startedAt || !dueDate) return null;

  const start = startedAt.getTime();
  const due = dueDate.getTime();
  const endpoint = completedAt?.getTime() ?? now.getTime();
  const duration = due - start;
  const percentage =
    duration <= 0
      ? 100
      : Math.min(
          100,
          Math.max(0, Math.round(((endpoint - start) / duration) * 100)),
        );

  if (completedAt) {
    return {
      percentage,
      state: endpoint <= due ? "completedOnTime" : "completedLate",
    };
  }

  if (endpoint >= due) return { percentage: 100, state: "overdue" };
  if (due - endpoint <= DAY_IN_MS) {
    return { percentage, state: "dueSoon" };
  }

  return { percentage, state: "onTrack" };
}

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
