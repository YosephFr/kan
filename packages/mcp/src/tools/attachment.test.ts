import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { registerAttachmentTools } from "./attachment.js";

vi.mock("../client.js", () => ({
  kanRequest: vi.fn(),
  putBinary: vi.fn(),
}));

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;
interface ToolRegistration {
  inputSchema: z.ZodRawShape;
  handler: ToolHandler;
}

describe("attachment MCP contracts", () => {
  const tools = new Map<string, ToolRegistration>();

  beforeEach(() => {
    vi.clearAllMocks();
    tools.clear();
    const server = {
      registerTool: vi.fn(
        (
          name: string,
          config: { inputSchema: z.ZodRawShape },
          handler: ToolHandler,
        ) => tools.set(name, { inputSchema: config.inputSchema, handler }),
      ),
    };
    registerAttachmentTools(server as unknown as McpServer);
  });

  it("creates an opaque upload session with a client-computed hash", async () => {
    vi.mocked(kanRequest).mockResolvedValue({
      url: "https://upload.test/url",
      uploadSessionPublicId: "uploadsess01",
    });
    const tool = tools.get("generate_attachment_upload_url");
    if (!tool) throw new Error("Upload URL tool was not registered");
    const input = z.object(tool.inputSchema).parse({
      cardPublicId: "cardpublic01",
      filename: "brief.pdf",
      contentType: "application/pdf",
      size: 100,
      sha256: "a".repeat(64),
    });

    await tool.handler(input);

    expect(kanRequest).toHaveBeenCalledWith(
      "POST",
      "/cards/cardpublic01/attachments/upload-url",
      {
        filename: "brief.pdf",
        contentType: "application/pdf",
        size: 100,
        sha256: "a".repeat(64),
      },
    );
  });

  it("confirms by upload session ID without accepting a storage key", async () => {
    vi.mocked(kanRequest).mockResolvedValue({ publicId: "attachment01" });
    const tool = tools.get("confirm_attachment_upload");
    if (!tool) throw new Error("Confirm tool was not registered");
    const input = z.object(tool.inputSchema).parse({
      cardPublicId: "cardpublic01",
      uploadSessionPublicId: "uploadsess01",
    });

    await tool.handler(input);

    expect(Object.keys(tool.inputSchema)).not.toContain("s3Key");
    expect(kanRequest).toHaveBeenCalledWith(
      "POST",
      "/cards/cardpublic01/attachments/confirm",
      { uploadSessionPublicId: "uploadsess01" },
    );
  });

  it("rejects unsupported local file formats before creating a session", async () => {
    const tool = tools.get("upload_card_attachment");
    if (!tool) throw new Error("Upload tool was not registered");

    await expect(
      tool.handler({
        cardPublicId: "cardpublic01",
        filePath: fileURLToPath(import.meta.url),
        filename: "payload.zip",
      }),
    ).rejects.toThrow("Unsupported attachment type");
    expect(kanRequest).not.toHaveBeenCalled();
  });
});
