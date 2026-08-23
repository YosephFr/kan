import { attachmentRouter } from "./routers/attachment";
import { boardRouter } from "./routers/board";
import { brandingRouter } from "./routers/branding";
import { cardRouter } from "./routers/card";
import { cardCanvasRouter } from "./routers/card-canvas";
import { cardPipelineRouter } from "./routers/card-pipeline";
import { cardResourceRouter } from "./routers/card-resource";
import { cardSubtaskRouter } from "./routers/card-subtask";
import { checklistRouter } from "./routers/checklist";
import { feedbackRouter } from "./routers/feedback";
import { healthRouter } from "./routers/health";
import { importRouter } from "./routers/import";
import { integrationRouter } from "./routers/integration";
import { labelRouter } from "./routers/label";
import { listRouter } from "./routers/list";
import { memberRouter } from "./routers/member";
import { notificationRouter } from "./routers/notification";
import { permissionRouter } from "./routers/permission";
import { pulseRouter } from "./routers/pulse";
import { userRouter } from "./routers/user";
import { webhookRouter } from "./routers/webhook";
import { workspaceRouter } from "./routers/workspace";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  attachment: attachmentRouter,
  board: boardRouter,
  branding: brandingRouter,
  card: cardRouter,
  cardCanvas: cardCanvasRouter,
  cardPipeline: cardPipelineRouter,
  cardResource: cardResourceRouter,
  cardSubtask: cardSubtaskRouter,
  checklist: checklistRouter,
  feedback: feedbackRouter,
  health: healthRouter,
  label: labelRouter,
  list: listRouter,
  member: memberRouter,
  notification: notificationRouter,
  import: importRouter,
  permission: permissionRouter,
  pulse: pulseRouter,
  user: userRouter,
  webhook: webhookRouter,
  workspace: workspaceRouter,
  integration: integrationRouter,
});

export type AppRouter = typeof appRouter;
