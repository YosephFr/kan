import crypto from "crypto";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import type {
  CardPipelineStageStatus,
  CardPriority,
  WebhookEvent,
} from "@kan/db/schema";
import * as webhookRepo from "@kan/db/repository/webhook.repo";
import { createLogger } from "@kan/logger";

const log = createLogger("webhook");

export type WebhookEventType = WebhookEvent;

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: {
    card: {
      id: string;
      publicId: string;
      title: string;
      description?: string | null;
      dueDate?: string | null; // ISO string after JSON serialization
      priority?: CardPriority;
      colourCode?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
      listId: string;
      boardId: string;
    };
    subtask?: {
      id: string;
      publicId: string;
      title: string;
      description?: string | null;
      priority: CardPriority;
      dueDate: string | null;
      startedAt: string | null;
      completedAt: string | null;
      index: number;
      stage: {
        publicId: string;
        status: CardPipelineStageStatus;
        name: string;
      };
      ownerPublicId: string | null;
    };
    board?: {
      id: string;
      name: string;
    };
    list?: {
      id: string;
      name: string;
    };
    user?: {
      id: string;
      name: string | null;
    };
    changes?: Record<string, { from: unknown; to: unknown }>;
  };
}

function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Zod schema for webhook URLs with SSRF mitigation.
 * Requires HTTPS and blocks private/internal IP ranges, localhost,
 * and cloud metadata endpoints.
 */
export const webhookUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine(
    (url) => {
      try {
        return new URL(url).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Only HTTPS URLs are allowed" },
  )
  .refine(
    (url) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        return !(
          hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname === "::1" ||
          hostname === "0.0.0.0"
        );
      } catch {
        return false;
      }
    },
    { message: "Localhost URLs are not allowed" },
  )
  .refine(
    (url) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        return !(
          hostname === "169.254.169.254" ||
          hostname === "metadata.google.internal"
        );
      } catch {
        return false;
      }
    },
    { message: "Cloud metadata endpoints are not allowed" },
  )
  .refine(
    (url) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        const ipv4Match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
        if (ipv4Match) {
          const a = Number(ipv4Match[1] ?? -1);
          const b = Number(ipv4Match[2] ?? -1);
          if (
            a === 10 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168)
          ) {
            return false;
          }
        }
        return true;
      } catch {
        return false;
      }
    },
    { message: "Private IP addresses are not allowed" },
  );

/**
 * Send a webhook payload to a specific URL.
 *
 * SSRF note: URL validation (HTTPS-only, no private IPs, no cloud metadata)
 * is enforced both here at delivery time and at webhook creation via
 * webhookUrlSchema. This function is only reachable by workspace admins.
 */
export async function sendWebhookToUrl(
  url: string,
  secret: string | undefined,
  payload: WebhookPayload,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const result = webhookUrlSchema.safeParse(url);
  if (!result.success) {
    return { success: false, error: result.error.issues[0]?.message };
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": payload.event,
    "X-Webhook-Timestamp": payload.timestamp,
  };

  if (secret) {
    headers["X-Webhook-Signature"] = generateSignature(body, secret);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: `${response.status} ${response.statusText}`,
      };
    }

    return { success: true, statusCode: response.status };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, error: "Request timed out" };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send webhook to all active webhooks for a workspace that are subscribed to the event.
 * Wrapped in try/catch so callers using fire-and-forget don't risk unhandled rejections.
 */
export async function sendWebhooksForWorkspace(
  db: dbClient,
  workspaceId: number,
  payload: WebhookPayload,
): Promise<void> {
  try {
    // Get active webhooks for this workspace and filter by event client-side
    const allWebhooks = await webhookRepo.getActiveByWorkspaceId(
      db,
      workspaceId,
    );
    const webhooksForEvent = allWebhooks.filter((w) =>
      w.events.includes(payload.event),
    );

    // Send to all subscribed webhooks in parallel (fire and forget)
    const promises = webhooksForEvent.map((webhook) =>
      sendWebhookToUrl(webhook.url, webhook.secret ?? undefined, payload).then(
        (result) => {
          if (!result.success) {
            log.error(
              {
                errorCode: "WEBHOOK_DELIVERY_FAILED",
                webhookPublicId: webhook.publicId,
                event: payload.event,
                statusCode: result.statusCode,
              },
              "Webhook delivery failed",
            );
          } else {
            log.info(
              {
                webhookPublicId: webhook.publicId,
                event: payload.event,
                statusCode: result.statusCode,
              },
              "Webhook delivered",
            );
          }
        },
      ),
    );

    // Wait for all to complete but don't block on failures
    await Promise.allSettled(promises);
  } catch {
    log.error(
      {
        errorCode: "WEBHOOK_DISPATCH_FAILED",
        workspaceId,
        event: payload.event,
      },
      "Failed to send webhooks for workspace",
    );
  }
}

export function createCardWebhookPayload(
  event: WebhookEventType,
  card: {
    publicId: string;
    title: string;
    description?: string | null;
    dueDate?: Date | null;
    priority?: CardPriority;
    colourCode?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    listId: string;
  },
  context: {
    boardId: string;
    boardName?: string;
    listName?: string;
    user?: {
      id: string;
      name: string | null;
    };
    changes?: Record<string, { from: unknown; to: unknown }>;
  },
): WebhookPayload {
  return {
    event,
    timestamp: new Date().toISOString(),
    data: {
      card: {
        id: card.publicId,
        publicId: card.publicId,
        title: card.title,
        description: card.description,
        dueDate: card.dueDate?.toISOString() ?? null,
        ...(card.priority !== undefined && { priority: card.priority }),
        ...(card.colourCode !== undefined && {
          colourCode: card.colourCode,
        }),
        ...(card.startedAt !== undefined && {
          startedAt: card.startedAt?.toISOString() ?? null,
        }),
        ...(card.completedAt !== undefined && {
          completedAt: card.completedAt?.toISOString() ?? null,
        }),
        listId: card.listId,
        boardId: context.boardId,
      },
      board: context.boardName
        ? { id: context.boardId, name: context.boardName }
        : undefined,
      list: context.listName
        ? { id: card.listId, name: context.listName }
        : undefined,
      user: context.user,
      changes: context.changes,
    },
  };
}

export function createSubtaskWebhookPayload(
  event: Extract<
    WebhookEventType,
    | "subtask.created"
    | "subtask.updated"
    | "subtask.moved"
    | "subtask.assigned"
    | "subtask.deleted"
  >,
  subtask: {
    publicId: string;
    title: string;
    description?: string | null;
    priority: CardPriority;
    dueDate: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    index: number;
    stage: {
      publicId: string;
      status: CardPipelineStageStatus;
      name: string;
    };
    ownerPublicId: string | null;
  },
  context: {
    card: {
      publicId: string;
      title: string;
      listPublicId: string;
    };
    board: { publicId: string; name: string };
    listName: string;
    changes?: Record<string, { from: unknown; to: unknown }>;
  },
): WebhookPayload {
  return {
    event,
    timestamp: new Date().toISOString(),
    data: {
      card: {
        id: context.card.publicId,
        publicId: context.card.publicId,
        title: context.card.title,
        listId: context.card.listPublicId,
        boardId: context.board.publicId,
      },
      subtask: {
        id: subtask.publicId,
        publicId: subtask.publicId,
        title: subtask.title,
        description: subtask.description,
        priority: subtask.priority,
        dueDate: subtask.dueDate?.toISOString() ?? null,
        startedAt: subtask.startedAt?.toISOString() ?? null,
        completedAt: subtask.completedAt?.toISOString() ?? null,
        index: subtask.index,
        stage: subtask.stage,
        ownerPublicId: subtask.ownerPublicId,
      },
      board: { id: context.board.publicId, name: context.board.name },
      list: { id: context.card.listPublicId, name: context.listName },
      changes: context.changes,
    },
  };
}
