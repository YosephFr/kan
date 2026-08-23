import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { registerCardCanvasTools } from "./card-canvas.js";

vi.mock("../client.js", () => ({ kanRequest: vi.fn() }));

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;
interface ToolRegistration {
  inputSchema: z.ZodRawShape;
  handler: ToolHandler;
}

describe("card canvas MCP tools", () => {
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
    registerCardCanvasTools(server as unknown as McpServer);
    vi.mocked(kanRequest).mockResolvedValue({ ok: true });
  });

  it("registers only the read and frame conversion tools", () => {
    expect([...tools.keys()].sort()).toEqual([
      "convert_canvas_frame_to_subtask",
      "list_card_canvas_frames",
    ]);
  });

  it("lists frames without requesting the canvas scene", async () => {
    await tools.get("list_card_canvas_frames")?.handler({
      cardPublicId: "card00000001",
    });

    expect(kanRequest).toHaveBeenCalledWith(
      "GET",
      "/cards/card00000001/canvas/frames",
    );
  });

  it("converts a frame using public IDs and a CAS version", async () => {
    const tool = tools.get("convert_canvas_frame_to_subtask");
    if (!tool) throw new Error("Frame conversion tool was not registered");
    const input = z.object(tool.inputSchema).parse({
      cardPublicId: "card00000001",
      framePublicId: "frame0000001",
      expectedVersion: 4,
      targetStageStatus: "inProgress",
      subtaskFields: {
        title: "Preparar propuesta",
        priority: "high",
        dueDate: "2026-08-25T12:00:00.000Z",
        ownerPublicId: "member000001",
      },
    });

    await tool.handler(input);

    expect(kanRequest).toHaveBeenCalledWith(
      "POST",
      "/cards/card00000001/canvas/convert-frame",
      {
        framePublicId: "frame0000001",
        expectedVersion: 4,
        targetStageStatus: "inProgress",
        subtaskFields: {
          title: "Preparar propuesta",
          priority: "high",
          dueDate: "2026-08-25T12:00:00.000Z",
          ownerPublicId: "member000001",
        },
      },
    );
  });

  it("rejects arbitrary scene input", () => {
    const tool = tools.get("convert_canvas_frame_to_subtask");
    if (!tool) throw new Error("Frame conversion tool was not registered");

    expect(() =>
      z
        .object(tool.inputSchema)
        .strict()
        .parse({
          cardPublicId: "card00000001",
          framePublicId: "frame0000001",
          expectedVersion: 1,
          targetStageStatus: "planned",
          subtaskFields: { title: "Tarea" },
          scene: { elements: [] },
        }),
    ).toThrow();
  });

  it("rejects path-like identifiers before building API URLs", () => {
    const tool = tools.get("list_card_canvas_frames");
    if (!tool) throw new Error("Frame list tool was not registered");

    expect(() =>
      z.object(tool.inputSchema).parse({ cardPublicId: "../cards/evil" }),
    ).toThrow();
  });
});
