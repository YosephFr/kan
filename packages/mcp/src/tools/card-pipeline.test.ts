import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { kanRequest } from "../client.js";
import { registerCardPipelineTools } from "./card-pipeline.js";

vi.mock("../client.js", () => ({ kanRequest: vi.fn() }));

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

describe("card pipeline MCP tools", () => {
  const handlers = new Map<string, ToolHandler>();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    const server = {
      registerTool: vi.fn(
        (name: string, _definition: unknown, handler: ToolHandler) => {
          handlers.set(name, handler);
        },
      ),
    };
    registerCardPipelineTools(server as unknown as McpServer);
    vi.mocked(kanRequest).mockResolvedValue({ ok: true });
  });

  it("registers the complete pipeline, subtask, checklist and attachment surface", () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        "assign_card_subtask",
        "create_card_subtask",
        "create_subtask_checklist_item",
        "delete_card_subtask",
        "delete_subtask_checklist_item",
        "get_card_pipeline",
        "initialize_card_pipeline",
        "link_attachment_to_subtask",
        "move_card_subtask",
        "reorder_card_subtasks",
        "reorder_subtask_checklist",
        "unlink_attachment_from_subtask",
        "update_card_pipeline_stages",
        "update_card_subtask",
        "update_subtask_checklist_item",
      ].sort(),
    );
  });

  it("reorders subtasks and checklist items through public IDs", async () => {
    await handlers.get("reorder_card_subtasks")?.({
      cardPublicId: "card00000001",
      stagePublicId: "stage0000001",
      orderedSubtaskPublicIds: ["subtask00001", "subtask00002"],
    });
    await handlers.get("reorder_subtask_checklist")?.({
      subtaskPublicId: "subtask00001",
      orderedItemPublicIds: ["item00000001", "item00000002"],
    });

    expect(kanRequest).toHaveBeenNthCalledWith(
      1,
      "PUT",
      "/cards/card00000001/pipeline/stages/stage0000001/subtasks/order",
      { orderedSubtaskPublicIds: ["subtask00001", "subtask00002"] },
    );
    expect(kanRequest).toHaveBeenNthCalledWith(
      2,
      "PUT",
      "/subtasks/subtask00001/checklist/order",
      { orderedItemPublicIds: ["item00000001", "item00000002"] },
    );
  });

  it("uses only public IDs in the pipeline read and subtask move contracts", async () => {
    await handlers.get("get_card_pipeline")?.({
      cardPublicId: "card00000001",
    });
    await handlers.get("move_card_subtask")?.({
      subtaskPublicId: "subtask00001",
      stagePublicId: "stage0000001",
      index: 2,
    });

    expect(kanRequest).toHaveBeenNthCalledWith(
      1,
      "GET",
      "/cards/card00000001/pipeline",
    );
    expect(kanRequest).toHaveBeenNthCalledWith(
      2,
      "POST",
      "/subtasks/subtask00001/move",
      { stagePublicId: "stage0000001", index: 2 },
    );
  });

  it("links a confirmed parent attachment by public ID", async () => {
    await handlers.get("link_attachment_to_subtask")?.({
      subtaskPublicId: "subtask00001",
      attachmentPublicId: "attach000001",
    });

    expect(kanRequest).toHaveBeenCalledWith(
      "POST",
      "/subtasks/subtask00001/attachments",
      { attachmentPublicId: "attach000001" },
    );
  });
});
