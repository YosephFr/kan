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

export const pulsePortfolioSummarySchema = z.object({
  refreshedAt: z.string().datetime(),
  period: z.object({
    key: z.enum(["week", "month"]),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
  totals: z.object({
    companies: z.number().int().nonnegative(),
    advanced: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    stalled: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
  }),
  companies: z.array(
    z.object({
      publicId: z.string(),
      name: z.string(),
      logo: z.string().nullable(),
      cardPrefix: z.string(),
      boards: z.number().int().nonnegative(),
      cards: z.number().int().nonnegative(),
      advanced: z.number().int().nonnegative(),
      delivered: z.number().int().nonnegative(),
      stalled: z.number().int().nonnegative(),
      open: z.number().int().nonnegative(),
    }),
  ),
  team: z.array(
    z.object({
      publicId: z.string(),
      name: z.string(),
      image: z.string().nullable(),
      totalAdvanced: z.number().int().nonnegative(),
      totalDelivered: z.number().int().nonnegative(),
      companies: z.array(
        z.object({
          workspacePublicId: z.string(),
          workspaceName: z.string(),
          memberPublicId: z.string(),
          advanced: z.number().int().nonnegative(),
          delivered: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
  coverage: z.object({
    cards: z.number().int().nonnegative(),
    cardsWithTransitions: z.number().int().nonnegative(),
    periodTransitions: z.number().int().nonnegative(),
    attributedPeriodTransitions: z.number().int().nonnegative(),
  }),
  configuration: z.object({
    plannedStaleDays: z.number().int().positive(),
    inProgressStaleDays: z.number().int().positive(),
    blockedStaleDays: z.number().int().positive(),
  }),
});

export const pulsePortfolioDetailSchema = z.object({
  refreshedAt: z.string().datetime(),
  period: z.object({
    key: z.enum(["week", "month"]),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
  metric: z.enum(["advanced", "delivered", "stalled", "open"]),
  workspace: z
    .object({
      publicId: z.string(),
      name: z.string(),
      logo: z.string().nullable(),
    })
    .nullable(),
  member: z
    .object({
      publicId: z.string(),
      name: z.string(),
    })
    .nullable(),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  items: z.array(
    z.object({
      cardPublicId: z.string(),
      cardNumber: z.number().int().nullable(),
      title: z.string(),
      workspacePublicId: z.string(),
      workspaceName: z.string(),
      workspaceLogo: z.string().nullable(),
      cardPrefix: z.string(),
      boardPublicId: z.string(),
      boardName: z.string(),
      listPublicId: z.string(),
      listName: z.string(),
      status: pulseStatusSchema,
      fromListName: z.string().nullable(),
      toListName: z.string().nullable(),
      lastChangedAt: z.string().datetime().nullable(),
      inactiveDays: z.number().int().nonnegative(),
      assignees: z.array(z.string()),
    }),
  ),
});

export type PulsePortfolioSummary = z.infer<typeof pulsePortfolioSummarySchema>;
export type PulsePortfolioDetail = z.infer<typeof pulsePortfolioDetailSchema>;
