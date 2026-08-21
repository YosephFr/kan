import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { registerBoardTools } from "./board.js";

vi.mock("../client.js", () => ({ kanRequest: vi.fn() }));

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

describe("update_board", () => {
  let schema: z.ZodRawShape;
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          toolSchema: z.ZodRawShape,
          toolHandler: ToolHandler,
        ) => {
          if (name === "update_board") {
            schema = toolSchema;
            handler = toolHandler;
          }
        },
      ),
      registerTool: vi.fn(),
    };
    registerBoardTools(server as unknown as McpServer);
  });

  it("forwards acknowledgement when publishing resources", async () => {
    vi.mocked(kanRequest).mockResolvedValue({ publicId: "board-public1" });
    const input = z.object(schema).parse({
      boardPublicId: "board-public1",
      visibility: "public",
      publicVisibilityAcknowledged: true,
    });

    await handler(input);

    expect(kanRequest).toHaveBeenCalledWith(
      "PUT",
      "/boards/board-public1",
      expect.objectContaining({ publicVisibilityAcknowledged: true }),
    );
  });
});
