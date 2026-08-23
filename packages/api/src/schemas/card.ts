import { z } from "zod";

import {
  boardVisibilityStatuses,
  cardPriorities,
  listStatuses,
} from "@kan/db/schema";

import { subtaskSummarySchema } from "./card-pipeline";
import { resourceSummarySchema } from "./card-resource";
import {
  checklistResponseSchema,
  labelSchema,
  workspaceMemberSchema,
} from "./common";

// ─── card.create ─────────────────────────────────────────────
export const cardCreateResponseSchema = z.object({
  publicId: z.string(),
  dueDate: z.date().nullable(),
  priority: z.enum(cardPriorities),
  colourCode: z.string().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
});

// ─── card.update ─────────────────────────────────────────────
export const cardUpdateResponseSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  dueDate: z.date().nullable(),
  priority: z.enum(cardPriorities),
  colourCode: z.string().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
});

// ─── Comment responses ───────────────────────────────────────
export const commentResponseSchema = z.object({
  publicId: z.string(),
  comment: z.string(),
});

export const commentDeleteResponseSchema = z.object({
  publicId: z.string(),
});

// ─── card.byId ───────────────────────────────────────────────

const cardMemberSchema = z.object({
  publicId: z.string(),
  email: z.string(),
  user: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
    })
    .nullable(),
});

export const cardDetailSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  cardNumber: z.number().nullable(),
  index: z.number(),
  dueDate: z.date().nullable(),
  priority: z.enum(cardPriorities),
  colourCode: z.string().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdBy: z.string().nullable(),
  labels: z.array(labelSchema),
  checklists: z.array(checklistResponseSchema),
  list: z.object({
    publicId: z.string(),
    name: z.string(),
    status: z.enum(listStatuses).nullable(),
    colourCode: z.string().nullable(),
    board: z.object({
      publicId: z.string(),
      name: z.string(),
      visibility: z.enum(boardVisibilityStatuses),
      labels: z.array(labelSchema),
      lists: z.array(
        z.object({
          publicId: z.string(),
          name: z.string(),
          status: z.enum(listStatuses).nullable(),
          colourCode: z.string().nullable(),
        }),
      ),
      workspace: z.object({
        publicId: z.string(),
        name: z.string(),
        cardPrefix: z.string(),
        members: z.array(workspaceMemberSchema),
      }),
    }),
  }),
  members: z.array(cardMemberSchema),
  subtaskSummary: subtaskSummarySchema,
  resourceSummary: resourceSummarySchema,
  hasCanvas: z.boolean(),
  activities: z.array(
    z.object({
      publicId: z.string(),
      type: z.string(),
      createdAt: z.date(),
      fromIndex: z.number().nullable(),
      toIndex: z.number().nullable(),
      fromTitle: z.string().nullable(),
      toTitle: z.string().nullable(),
      fromDescription: z.string().nullable(),
      toDescription: z.string().nullable(),
      fromDueDate: z.date().nullable(),
      toDueDate: z.date().nullable(),
      fromPriority: z.enum(cardPriorities).nullable(),
      toPriority: z.enum(cardPriorities).nullable(),
      fromColourCode: z.string().nullable(),
      toColourCode: z.string().nullable(),
      subtaskPublicId: z.string().length(12).nullable(),
      fromPipelineStagePublicId: z.string().length(12).nullable(),
      toPipelineStagePublicId: z.string().length(12).nullable(),
      fromList: z
        .object({
          publicId: z.string(),
          name: z.string(),
          index: z.number(),
        })
        .nullable(),
      toList: z
        .object({
          publicId: z.string(),
          name: z.string(),
          index: z.number(),
        })
        .nullable(),
      label: z
        .object({
          publicId: z.string(),
          name: z.string(),
        })
        .nullable(),
      member: z
        .object({
          publicId: z.string(),
          user: z
            .object({
              name: z.string().nullable(),
              email: z.string(),
            })
            .nullable(),
        })
        .nullable(),
      user: z
        .object({
          name: z.string().nullable(),
          email: z.string(),
        })
        .nullable(),
      comment: z
        .object({
          publicId: z.string(),
          comment: z.string(),
          createdBy: z.string().nullable(),
          updatedAt: z.date().nullable(),
          deletedAt: z.date().nullable(),
        })
        .nullable(),
    }),
  ),
});

// ─── card.getActivities ──────────────────────────────────────
export const activityItemSchema = z.object({
  publicId: z.string(),
  type: z.string(),
  createdAt: z.date(),
  fromIndex: z.number().nullable(),
  toIndex: z.number().nullable(),
  fromTitle: z.string().nullable(),
  toTitle: z.string().nullable(),
  fromDescription: z.string().nullable(),
  toDescription: z.string().nullable(),
  fromDueDate: z.date().nullable(),
  toDueDate: z.date().nullable(),
  fromPriority: z.enum(cardPriorities).nullable(),
  toPriority: z.enum(cardPriorities).nullable(),
  fromColourCode: z.string().nullable(),
  toColourCode: z.string().nullable(),
  subtaskPublicId: z.string().length(12).nullable(),
  fromPipelineStagePublicId: z.string().length(12).nullable(),
  toPipelineStagePublicId: z.string().length(12).nullable(),
  fromList: z
    .object({
      publicId: z.string(),
      name: z.string(),
      index: z.number(),
    })
    .nullable(),
  toList: z
    .object({
      publicId: z.string(),
      name: z.string(),
      index: z.number(),
    })
    .nullable(),
  label: z
    .object({
      publicId: z.string(),
      name: z.string(),
    })
    .nullable(),
  member: z
    .object({
      publicId: z.string(),
      user: z
        .object({
          id: z.string().nullable(),
          name: z.string().nullable(),
          email: z.string(),
          image: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  user: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
      email: z.string(),
      image: z.string().nullable(),
    })
    .nullable(),
  comment: z
    .object({
      publicId: z.string(),
      comment: z.string(),
      createdBy: z.string().nullable(),
      updatedAt: z.date().nullable(),
      deletedAt: z.date().nullable(),
    })
    .nullable(),
  attachment: z
    .object({
      publicId: z.string(),
      filename: z.string(),
      originalFilename: z.string().nullable(),
    })
    .nullable(),
});
