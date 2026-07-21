import { z } from "zod";

const pulseStatusSchema = z.enum([
  "planned",
  "inProgress",
  "blocked",
  "done",
  "other",
]);

const attentionReasonSchema = z.enum([
  "blocked",
  "overdue",
  "stalled",
  "unassigned",
]);

export const pulseSummarySchema = z.object({
  refreshedAt: z.string().datetime(),
  period: z.object({
    key: z.enum(["week", "month"]),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
  kpis: z.object({
    delivered: z.number().int().nonnegative(),
    stalled: z.number().int().nonnegative(),
    cycleTimeHours: z.number().nonnegative().nullable(),
  }),
  totals: z.object({
    cards: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    unassigned: z.number().int().nonnegative(),
  }),
  statuses: z.array(
    z.object({
      key: pulseStatusSchema,
      count: z.number().int().nonnegative(),
    }),
  ),
  trend: z.array(
    z.object({
      startsAt: z.string().datetime(),
      delivered: z.number().int().nonnegative(),
      current: z.boolean(),
    }),
  ),
  workload: z.array(
    z.object({
      memberPublicId: z.string().nullable(),
      name: z.string(),
      active: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
      stalled: z.number().int().nonnegative(),
    }),
  ),
  checklist: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    percent: z.number().int().min(0).max(100).nullable(),
  }),
  attention: z.array(
    z.object({
      cardPublicId: z.string(),
      cardNumber: z.number().int().nullable(),
      title: z.string(),
      boardPublicId: z.string(),
      boardName: z.string(),
      listPublicId: z.string(),
      listName: z.string(),
      status: pulseStatusSchema,
      reasons: z.array(attentionReasonSchema),
      inactiveDays: z.number().int().nonnegative(),
      dueDate: z.string().datetime().nullable(),
      assignees: z.array(z.string()),
    }),
  ),
  coverage: z.object({
    cards: z.number().int().nonnegative(),
    cardsWithTransitions: z.number().int().nonnegative(),
    cycleSamples: z.number().int().nonnegative(),
    historyStartAt: z.string().datetime().nullable(),
  }),
  configuration: z.object({
    plannedStaleDays: z.number().int().positive(),
    inProgressStaleDays: z.number().int().positive(),
    blockedStaleDays: z.number().int().positive(),
  }),
  workspace: z.object({
    publicId: z.string(),
    name: z.string(),
    cardPrefix: z.string(),
  }),
});

export type PulseSummary = z.infer<typeof pulseSummarySchema>;
