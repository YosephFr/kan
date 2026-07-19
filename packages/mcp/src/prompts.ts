import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "meeting_to_kan",
    {
      title: "Meeting to Kan",
      description:
        "Turn a meeting transcript into a reviewed, idempotent Kan import.",
      argsSchema: {
        transcript: z.string().min(1),
        targetHint: z.string().optional(),
      },
    },
    ({ transcript, targetHint }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Convert the transcript below into an actionable Kan plan.

Before mutating Kan, establish through concise questions:
1. The destination workspace and whether the board already exists or must be created.
2. The intended board, lists, and treatment of completed work.
3. The responsible users, role or permission expectations, due dates, and source files to attach.
4. Any uncertain owner, date, duplicate, or item that should remain informational.

Inspect Kan first. Use ensure_workspace_board with mode=plan, then sync_board_cards with mode=plan. Present the planned changes and apply only after user confirmation. Keep card titles concise, descriptions structured in Markdown, decisions and acceptance criteria explicit, and checklists genuinely actionable. Never invent assignees or deadlines. Preserve existing manual content and avoid duplicate cards.

Target hint: ${targetHint ?? "None provided"}

Transcript:
${transcript}`,
          },
        },
      ],
    }),
  );
}
