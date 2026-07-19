import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest, putBinary } from "../client.js";
import { jsonResult } from "../result.js";

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

const contentTypes: Record<string, string> = {
  ".csv": "text/csv",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4a": "audio/mp4",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

function inferContentType(filePath: string): string {
  return (
    contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}

function sanitizedFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 200);
}

export function registerAttachmentTools(server: McpServer): void {
  server.registerTool(
    "generate_attachment_upload_url",
    {
      description:
        "Generate a one-hour presigned upload URL for a card attachment.",
      inputSchema: {
        cardPublicId: z.string().min(12),
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1),
        size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ cardPublicId, filename, contentType, size }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/cards/${cardPublicId}/attachments/upload-url`,
          { filename, contentType, size },
        ),
      ),
  );

  server.registerTool(
    "confirm_attachment_upload",
    {
      description:
        "Confirm a completed object upload and create its card attachment record.",
      inputSchema: {
        cardPublicId: z.string().min(12),
        s3Key: z.string().min(1),
        filename: z.string().min(1),
        originalFilename: z.string().min(1),
        contentType: z.string().min(1),
        size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
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
      s3Key,
      filename,
      originalFilename,
      contentType,
      size,
    }) =>
      jsonResult(
        await kanRequest("POST", `/cards/${cardPublicId}/attachments/confirm`, {
          s3Key,
          filename,
          originalFilename,
          contentType,
          size,
        }),
      ),
  );

  server.registerTool(
    "upload_card_attachment",
    {
      description:
        "Upload one explicitly supplied local file to a card, then confirm the attachment in Kan. The path must identify a regular file no larger than 50 MiB.",
      inputSchema: {
        cardPublicId: z.string().min(12),
        filePath: z.string().min(1),
        filename: z.string().min(1).max(255).optional(),
        contentType: z.string().min(1).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ cardPublicId, filePath, filename, contentType }) => {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw new Error(`Attachment path is not a regular file: ${filePath}`);
      }
      if (fileStat.size <= 0 || fileStat.size > MAX_ATTACHMENT_SIZE) {
        throw new Error("Attachments must be between 1 byte and 50 MiB");
      }

      const originalFilename = filename ?? basename(filePath);
      const resolvedContentType =
        contentType ?? inferContentType(originalFilename);
      const upload = await kanRequest<{ url: string; key: string }>(
        "POST",
        `/cards/${cardPublicId}/attachments/upload-url`,
        {
          filename: originalFilename,
          contentType: resolvedContentType,
          size: fileStat.size,
        },
      );

      await putBinary(
        upload.url,
        await readFile(filePath),
        resolvedContentType,
      );

      return jsonResult(
        await kanRequest("POST", `/cards/${cardPublicId}/attachments/confirm`, {
          s3Key: upload.key,
          filename: sanitizedFilename(originalFilename),
          originalFilename,
          contentType: resolvedContentType,
          size: fileStat.size,
        }),
      );
    },
  );

  server.registerTool(
    "delete_attachment",
    {
      description:
        "Soft-delete an attachment and remove its object from storage.",
      inputSchema: { attachmentPublicId: z.string().min(12) },
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
