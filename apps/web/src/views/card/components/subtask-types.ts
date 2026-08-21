import type { RouterOutputs } from "~/utils/api";

export type CardPipelineData = RouterOutputs["cardPipeline"]["get"];
export type CardPipelineStage = CardPipelineData["stages"][number];
export type CardSubtask = CardPipelineStage["subtasks"][number];
export type SubtaskOwner = NonNullable<CardSubtask["owner"]>;
export type SubtaskChecklistItem = CardSubtask["checklistItems"][number];
export type PipelineStageStatus = CardPipelineStage["status"];

export interface WorkspaceMemberOption {
  publicId: string;
  email: string;
  user: {
    name: string | null;
    email: string;
    image: string | null;
  } | null;
}
