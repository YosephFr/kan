import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { registerCardResourceTools } from "./card-resource.js";

vi.mock("../client.js", () => ({ kanRequest: vi.fn() }));

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;
interface ToolRegistration {
  inputSchema: z.ZodRawShape;
  handler: ToolHandler;
}

describe("card resource MCP tools", () => {
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
    registerCardResourceTools(server as unknown as McpServer);
    vi.mocked(kanRequest).mockResolvedValue({ ok: true });
  });

  it("registers the complete resource surface", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_drive_link_to_card",
        "delete_card_resource",
        "link_resource_to_subtask",
        "list_card_resources",
        "unlink_resource_from_subtask",
      ].sort(),
    );
  });

  it("lists a card's resources using only its public ID", async () => {
    await tools.get("list_card_resources")?.handler({
      cardPublicId: "card00000001",
    });

    expect(kanRequest).toHaveBeenCalledWith(
      "GET",
      "/cards/card00000001/resources",
    );
  });

  it("adds a Drive link with the public-board acknowledgement", async () => {
    const tool = tools.get("add_drive_link_to_card");
    if (!tool) throw new Error("Drive link tool was not registered");
    const input = z.object(tool.inputSchema).parse({
      cardPublicId: "card00000001",
      url: "https://docs.google.com/document/d/file00000001/edit",
      title: "Brief",
      publicVisibilityAcknowledged: true,
    });

    await tool.handler(input);

    expect(kanRequest).toHaveBeenCalledWith(
      "POST",
      "/cards/card00000001/resources/drive",
      {
        url: "https://docs.google.com/document/d/file00000001/edit",
        title: "Brief",
        publicVisibilityAcknowledged: true,
      },
    );
  });

  it("links and unlinks a resource through public IDs", async () => {
    await tools.get("link_resource_to_subtask")?.handler({
      subtaskPublicId: "subtask00001",
      resourcePublicId: "resource0001",
    });
    await tools.get("unlink_resource_from_subtask")?.handler({
      subtaskPublicId: "subtask00001",
      resourcePublicId: "resource0001",
    });

    expect(kanRequest).toHaveBeenNthCalledWith(
      1,
      "POST",
      "/subtasks/subtask00001/resources",
      { resourcePublicId: "resource0001" },
    );
    expect(kanRequest).toHaveBeenNthCalledWith(
      2,
      "DELETE",
      "/subtasks/subtask00001/resources/resource0001",
    );
  });

  it("requires an explicit usage-removal confirmation in the delete body", async () => {
    await tools.get("delete_card_resource")?.handler({
      resourcePublicId: "resource0001",
    });
    await tools.get("delete_card_resource")?.handler({
      resourcePublicId: "resource0001",
      confirmUsageRemoval: true,
    });

    expect(kanRequest).toHaveBeenNthCalledWith(
      1,
      "DELETE",
      "/resources/resource0001",
    );
    expect(kanRequest).toHaveBeenNthCalledWith(
      2,
      "DELETE",
      "/resources/resource0001?removeReferences=true",
    );
  });
});
