import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { registerCardTools } from "./card.js";

vi.mock("../client.js", () => ({ kanRequest: vi.fn() }));

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

describe("duplicate_card", () => {
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
          if (name === "duplicate_card") {
            schema = toolSchema;
            handler = toolHandler;
          }
        },
      ),
    };

    registerCardTools(server as unknown as McpServer);
  });

  it("sends the exact duplicate-card API contract", async () => {
    vi.mocked(kanRequest).mockResolvedValue({ publicId: "card-copy001" });
    const input = z.object(schema).parse({
      cardPublicId: "card-source1",
      listPublicId: "list-target1",
      title: "Copied task",
      index: 2,
      copyLabels: false,
      copyMembers: true,
      copyChecklists: false,
    });

    await handler(input);

    expect(kanRequest).toHaveBeenCalledWith(
      "POST",
      "/cards/card-source1/duplicate",
      {
        listPublicId: "list-target1",
        title: "Copied task",
        index: 2,
        copyLabels: false,
        copyMembers: true,
        copyChecklists: false,
      },
    );
  });

  it("defaults every copy option to true", async () => {
    vi.mocked(kanRequest).mockResolvedValue({ publicId: "card-copy001" });
    const input = z.object(schema).parse({
      cardPublicId: "card-source1",
      listPublicId: "list-target1",
    });

    await handler(input);

    expect(kanRequest).toHaveBeenCalledWith(
      "POST",
      "/cards/card-source1/duplicate",
      expect.objectContaining({
        listPublicId: "list-target1",
        copyLabels: true,
        copyMembers: true,
        copyChecklists: true,
      }),
    );
  });
});
