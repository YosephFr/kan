import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest, putBinary } from "../client.js";
import { jsonResult } from "../result.js";

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

const contentTypes: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const allowedContentTypes = new Set(Object.values(contentTypes));

function inferContentType(filePath: string): string {
  return (
    contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}

export function registerAttachmentTools(server: McpServer): void {
  server.registerTool(
    "generate_attachment_upload_url",
    {
      description:
        "Generate a one-hour presigned upload URL for a card attachment.",
      inputSchema: {
        cardPublicId: z.string().length(12),
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1),
        size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i),
        publicVisibilityAcknowledged: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      cardPublicId,
      filename,
      contentType,
      size,
      sha256,
      publicVisibilityAcknowledged,
    }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/cards/${cardPublicId}/attachments/upload-url`,
          {
            filename,
            contentType,
            size,
            sha256,
            ...(publicVisibilityAcknowledged !== undefined
              ? { publicVisibilityAcknowledged }
              : {}),
          },
        ),
      ),
  );

  server.registerTool(
    "confirm_attachment_upload",
    {
      description:
        "Confirm a completed object upload and create its card attachment record.",
      inputSchema: {
        cardPublicId: z.string().length(12),
        uploadSessionPublicId: z.string().length(12),
        publicVisibilityAcknowledged: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      cardPublicId,
      uploadSessionPublicId,
      publicVisibilityAcknowledged,
    }) =>
      jsonResult(
        await kanRequest("POST", `/cards/${cardPublicId}/attachments/confirm`, {
          uploadSessionPublicId,
          ...(publicVisibilityAcknowledged !== undefined
            ? { publicVisibilityAcknowledged }
            : {}),
        }),
      ),
  );

  server.registerTool(
    "upload_card_attachment",
    {
      description:
        "Upload one explicitly supplied local file to a card, then confirm the attachment in Kan. The path must identify a regular file no larger than 50 MiB.",
      inputSchema: {
        cardPublicId: z.string().length(12),
        filePath: z.string().min(1),
        filename: z.string().min(1).max(255).optional(),
        contentType: z.string().min(1).optional(),
        publicVisibilityAcknowledged: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      cardPublicId,
      filePath,
      filename,
      contentType,
      publicVisibilityAcknowledged,
    }) => {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw new Error(`Attachment path is not a regular file: ${filePath}`);
      }
      if (fileStat.size <= 0 || fileStat.size > MAX_ATTACHMENT_SIZE) {
        throw new Error("Attachments must be between 1 byte and 50 MiB");
      }

      const originalFilename = filename ?? basename(filePath);
      const resolvedContentType = (
        contentType ?? inferContentType(originalFilename)
      )
        .split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        !resolvedContentType ||
        !allowedContentTypes.has(resolvedContentType)
      ) {
        throw new Error("Unsupported attachment type");
      }
      const data = await readFile(filePath);
      const sha256 = createHash("sha256").update(data).digest("hex");
      const upload = await kanRequest<{
        url: string;
        uploadSessionPublicId: string;
      }>("POST", `/cards/${cardPublicId}/attachments/upload-url`, {
        filename: originalFilename,
        contentType: resolvedContentType,
        size: fileStat.size,
        sha256,
        ...(publicVisibilityAcknowledged !== undefined
          ? { publicVisibilityAcknowledged }
          : {}),
      });

      await putBinary(upload.url, data, resolvedContentType);

      return jsonResult(
        await kanRequest("POST", `/cards/${cardPublicId}/attachments/confirm`, {
          uploadSessionPublicId: upload.uploadSessionPublicId,
          ...(publicVisibilityAcknowledged !== undefined
            ? { publicVisibilityAcknowledged }
            : {}),
        }),
      );
    },
  );

  server.registerTool(
    "delete_attachment",
    {
      description:
        "Soft-delete an attachment and remove its object from storage.",
      inputSchema: { attachmentPublicId: z.string().length(12) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ attachmentPublicId }) =>
      jsonResult(
        await kanRequest("DELETE", `/attachments/${attachmentPublicId}`),
      ),
  );
}
