import { z } from "zod";

import { cardPipelineStageStatuses, cardPriorities } from "@kan/db/schema";

export const subtaskSummarySchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  blocked: z.number().int().min(0),
  progressPercent: z.number().int().min(0).max(100),
});

export const cardSubtaskOwnerSchema = z.object({
  publicId: z.string().length(12),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

export const cardSubtaskChecklistItemSchema = z.object({
  publicId: z.string().length(12),
  title: z.string(),
  completed: z.boolean(),
  index: z.number().int().min(0),
});

export const cardSubtaskResourceSchema = z.object({
  publicId: z.string().length(12),
  attachmentPublicId: z.string().length(12),
  filename: z.string(),
  contentType: z.string(),
  originalFilename: z.string().nullable(),
  size: z.number().nullable(),
  viewUrl: z.string().nullable(),
  downloadUrl: z.string(),
});

export const cardSubtaskSchema = z.object({
  publicId: z.string().length(12),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(cardPriorities),
  dueDate: z.date().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  index: z.number().int().min(0),
  stagePublicId: z.string().length(12),
  owner: cardSubtaskOwnerSchema.nullable(),
  checklistItems: z.array(cardSubtaskChecklistItemSchema),
  resources: z.array(cardSubtaskResourceSchema),
});

export const cardPipelineStageSchema = z.object({
  publicId: z.string().length(12),
  status: z.enum(cardPipelineStageStatuses),
  name: z.string(),
  colourCode: z.string().nullable(),
  index: z.number().int().min(0).max(3),
  subtasks: z.array(cardSubtaskSchema),
});

export const cardPipelineSchema = z.object({
  initialized: z.boolean(),
  stages: z.array(cardPipelineStageSchema),
  summary: subtaskSummarySchema,
});
