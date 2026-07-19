import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { WorkspaceSummary } from "../workspaces.js";
import { kanRequest } from "../client.js";
import { jsonResult } from "../result.js";
import { getWorkspaceSummaries } from "../workspaces.js";

interface BoardSummary {
  publicId: string;
  name: string;
  slug: string;
}

interface LabelSummary {
  publicId: string;
  name: string;
  colourCode: string | null;
}

interface MemberSummary {
  publicId: string;
  email: string;
  status: string;
  user: { email: string } | null;
}

interface ChecklistItemSummary {
  publicId: string;
  title: string;
  completed: boolean;
}

interface ChecklistSummary {
  publicId: string;
  name: string;
  items: ChecklistItemSummary[];
}

interface CardSummary {
  publicId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  labels: LabelSummary[];
  members: { publicId: string; email: string }[];
  checklists: ChecklistSummary[];
}

type CardCreateResponse = Omit<CardSummary, "checklists"> & {
  checklists?: ChecklistSummary[];
};

type ChecklistCreateResponse = Omit<ChecklistSummary, "items"> & {
  items?: ChecklistItemSummary[];
};

interface ListSummary {
  publicId: string;
  name: string;
  cards: CardSummary[];
}

interface BoardDetail {
  publicId: string;
  name: string;
  slug: string;
  visibility: string;
  workspace: {
    publicId: string;
    members: MemberSummary[];
  };
  labels: LabelSummary[];
  lists: ListSummary[];
}

interface SyncLabelInput {
  name: string;
  colourCode?: string;
}

interface SyncChecklistInput {
  name: string;
  items: { title: string; completed: boolean }[];
}

interface SyncCardInput {
  matchTitle?: string;
  title: string;
  listName: string;
  description?: string | null;
  dueDate?: string | null;
  assigneeEmails?: string[];
  labels?: SyncLabelInput[];
  checklists?: SyncChecklistInput[];
}

const labelInputSchema = z.object({
  name: z.string().min(1).max(255),
  colourCode: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const checklistInputSchema = z.object({
  name: z.string().min(1).max(255),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(2000),
        completed: z.boolean().default(false),
      }),
    )
    .max(100),
});

const cardInputSchema = z.object({
  matchTitle: z.string().min(1).max(2000).optional(),
  title: z.string().min(1).max(2000),
  listName: z.string().min(1),
  description: z.string().max(10000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  assigneeEmails: z.array(z.string().email()).max(25).optional(),
  labels: z.array(labelInputSchema).max(25).optional(),
  checklists: z.array(checklistInputSchema).max(25).optional(),
});

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = normalized(value);
    if (seen.has(key)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(key);
  }
}

function uniqueMatch<T>(
  values: T[],
  predicate: (value: T) => boolean,
  description: string,
): T | undefined {
  const matches = values.filter(predicate);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous ${description}: found ${matches.length} matches`,
    );
  }
  return matches[0];
}

function requiredMapValue<T>(
  values: Map<string, T>,
  key: string,
  description: string,
): T {
  const value = values.get(key);
  if (!value) throw new Error(`${description} not found`);
  return value;
}

function sameDate(left: string | null, right: string | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
}

export function registerAutomationTools(server: McpServer): void {
  server.registerTool(
    "ensure_workspace_board",
    {
      description:
        "Plan or idempotently create a workspace, one board, and its required lists. Existing content is never deleted. Use mode=plan before apply when the target was not already confirmed by the user.",
      inputSchema: {
        workspaceName: z.string().min(1).max(255),
        workspaceSlug: z.string().min(3).max(60).optional(),
        boardName: z.string().min(1).max(255),
        boardSlug: z.string().min(3).max(60).optional(),
        visibility: z.enum(["public", "private"]).default("private"),
        listNames: z.array(z.string().min(1).max(255)).min(1).max(25),
        mode: z.enum(["plan", "apply"]).default("plan"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      workspaceName,
      workspaceSlug,
      boardName,
      boardSlug,
      visibility,
      listNames,
      mode,
    }) => {
      assertUnique(listNames, "list name");
      const actions: { action: string; target: string }[] = [];
      const workspaces = await getWorkspaceSummaries();
      let workspace = uniqueMatch(
        workspaces,
        (candidate) => normalized(candidate.name) === normalized(workspaceName),
        `workspace name "${workspaceName}"`,
      );

      if (!workspace) {
        actions.push({ action: "create_workspace", target: workspaceName });
        if (mode === "plan") {
          actions.push({ action: "create_board", target: boardName });
          actions.push(
            ...listNames.map((name) => ({
              action: "create_list",
              target: name,
            })),
          );
          return jsonResult({ mode, actions });
        }
        workspace = await kanRequest<WorkspaceSummary>("POST", "/workspaces", {
          name: workspaceName,
          slug: workspaceSlug,
        });
      }

      const boards = await kanRequest<BoardSummary[]>(
        "GET",
        `/workspaces/${workspace.publicId}/boards`,
      );
      let board = uniqueMatch(
        boards,
        (candidate) => normalized(candidate.name) === normalized(boardName),
        `board name "${boardName}"`,
      );

      if (!board) {
        actions.push({ action: "create_board", target: boardName });
        actions.push(
          ...listNames.map((name) => ({
            action: "create_list",
            target: name,
          })),
        );
        if (mode === "plan") {
          return jsonResult({
            mode,
            workspacePublicId: workspace.publicId,
            actions,
          });
        }
        board = await kanRequest<BoardSummary>(
          "POST",
          `/workspaces/${workspace.publicId}/boards`,
          { name: boardName, lists: listNames, labels: [] },
        );
        const createdBoard = await kanRequest<BoardDetail>(
          "GET",
          `/boards/${board.publicId}`,
        );
        const boardUpdate: Record<string, string> = {};
        if (boardSlug && createdBoard.slug !== boardSlug) {
          boardUpdate.slug = boardSlug;
        }
        if (createdBoard.visibility !== visibility) {
          boardUpdate.visibility = visibility;
        }
        if (Object.keys(boardUpdate).length > 0) {
          await kanRequest("PUT", `/boards/${board.publicId}`, boardUpdate);
        }
      }

      const boardDetail = await kanRequest<BoardDetail>(
        "GET",
        `/boards/${board.publicId}`,
      );
      const existingLists = new Set(
        boardDetail.lists.map((list) => normalized(list.name)),
      );

      for (const listName of listNames) {
        if (existingLists.has(normalized(listName))) continue;
        actions.push({ action: "create_list", target: listName });
        if (mode === "apply") {
          await kanRequest("POST", "/lists", {
            boardPublicId: board.publicId,
            name: listName,
          });
        }
      }

      return jsonResult({
        mode,
        workspacePublicId: workspace.publicId,
        boardPublicId: board.publicId,
        actions,
      });
    },
  );

  server.registerTool(
    "sync_board_cards",
    {
      description:
        "Plan or idempotently upsert as many as 100 cards by title. It can move cards between named lists, merge or replace labels and assignments, and upsert checklist items without deleting unspecified content. Validate with mode=plan first for meeting imports.",
      inputSchema: {
        boardPublicId: z.string().min(12),
        cards: z.array(cardInputSchema).min(1).max(100),
        relationMode: z.enum(["merge", "replace"]).default("merge"),
        continueOnError: z.boolean().default(false),
        mode: z.enum(["plan", "apply"]).default("plan"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ boardPublicId, cards, relationMode, continueOnError, mode }) => {
      const typedCards = cards as SyncCardInput[];
      assertUnique(
        typedCards.map((card) => card.matchTitle ?? card.title),
        "card match title",
      );

      const board = await kanRequest<BoardDetail>(
        "GET",
        `/boards/${boardPublicId}`,
      );
      const listsByName = new Map(
        board.lists.map((list) => [normalized(list.name), list]),
      );
      const allCards = board.lists.flatMap((list) =>
        list.cards.map((card) => ({ card, list })),
      );
      const membersByEmail = new Map<string, MemberSummary>();
      for (const member of board.workspace.members) {
        membersByEmail.set(normalized(member.email), member);
        if (member.user?.email) {
          membersByEmail.set(normalized(member.user.email), member);
        }
      }

      for (const card of typedCards) {
        if (!listsByName.has(normalized(card.listName))) {
          throw new Error(`List not found on board: ${card.listName}`);
        }
        for (const email of card.assigneeEmails ?? []) {
          if (!membersByEmail.has(normalized(email))) {
            throw new Error(`Workspace member not found: ${email}`);
          }
        }
        uniqueMatch(
          allCards,
          ({ card: existing }) =>
            normalized(existing.title) ===
            normalized(card.matchTitle ?? card.title),
          `card title "${card.matchTitle ?? card.title}"`,
        );
      }

      const labelsByName = new Map(
        board.labels.map((label) => [normalized(label.name), label]),
      );
      const requestedLabels = new Map<string, SyncLabelInput>();
      for (const card of typedCards) {
        for (const label of card.labels ?? []) {
          const key = normalized(label.name);
          const previous = requestedLabels.get(key);
          if (
            previous?.colourCode &&
            label.colourCode &&
            previous.colourCode.toLowerCase() !== label.colourCode.toLowerCase()
          ) {
            throw new Error(
              `Conflicting colours requested for label: ${label.name}`,
            );
          }
          requestedLabels.set(key, previous ?? label);
        }
      }

      const plan: { action: string; target: string }[] = [];
      for (const [key, label] of requestedLabels) {
        if (labelsByName.has(key)) continue;
        plan.push({ action: "create_label", target: label.name });
        if (mode === "apply") {
          const created = await kanRequest<LabelSummary>("POST", "/labels", {
            boardPublicId,
            name: label.name,
            colourCode: label.colourCode ?? "#0d9488",
          });
          labelsByName.set(key, created);
        }
      }

      for (const input of typedCards) {
        const existing = uniqueMatch(
          allCards,
          ({ card }) =>
            normalized(card.title) ===
            normalized(input.matchTitle ?? input.title),
          `card title "${input.matchTitle ?? input.title}"`,
        );
        plan.push({
          action: existing ? "sync_card" : "create_card",
          target: input.title,
        });
      }

      if (mode === "plan") {
        return jsonResult({ mode, boardPublicId, plan });
      }

      const results: {
        title: string;
        publicId?: string;
        status: "created" | "updated" | "unchanged" | "error";
        error?: string;
      }[] = [];

      for (const input of typedCards) {
        try {
          const targetList = listsByName.get(normalized(input.listName));
          if (!targetList) throw new Error(`List not found: ${input.listName}`);
          const desiredLabelIds = (input.labels ?? []).map((label) => {
            const match = labelsByName.get(normalized(label.name));
            if (!match) throw new Error(`Label not found: ${label.name}`);
            return match.publicId;
          });
          const desiredMemberIds = (input.assigneeEmails ?? []).map((email) => {
            const match = membersByEmail.get(normalized(email));
            if (!match) throw new Error(`Workspace member not found: ${email}`);
            return match.publicId;
          });
          const existing = uniqueMatch(
            allCards,
            ({ card }) =>
              normalized(card.title) ===
              normalized(input.matchTitle ?? input.title),
            `card title "${input.matchTitle ?? input.title}"`,
          );
          const currentListPublicId = existing?.list.publicId;
          let card = existing?.card;
          let changed = false;

          if (!card) {
            const created = await kanRequest<CardCreateResponse>(
              "POST",
              "/cards",
              {
                listPublicId: targetList.publicId,
                title: input.title,
                description: input.description ?? "",
                dueDate: input.dueDate,
                labelPublicIds: desiredLabelIds,
                memberPublicIds: desiredMemberIds,
                position: "end",
              },
            );
            card = {
              ...created,
              title: input.title,
              description: input.description ?? "",
              dueDate: input.dueDate ?? null,
              labels: (input.labels ?? []).map((label) =>
                requiredMapValue(
                  labelsByName,
                  normalized(label.name),
                  `Label ${label.name}`,
                ),
              ),
              members: desiredMemberIds.map((publicId) => ({
                publicId,
                email: "",
              })),
              checklists: created.checklists ?? [],
            };
            changed = true;
          } else {
            const update: Record<string, unknown> = {};
            if (card.title !== input.title) update.title = input.title;
            if (currentListPublicId !== targetList.publicId) {
              update.listPublicId = targetList.publicId;
            }
            if (
              input.description !== undefined &&
              card.description !== input.description
            ) {
              update.description = input.description ?? "";
            }
            if (
              input.dueDate !== undefined &&
              !sameDate(card.dueDate, input.dueDate)
            ) {
              update.dueDate = input.dueDate;
            }
            if (Object.keys(update).length > 0) {
              await kanRequest("PUT", `/cards/${card.publicId}`, update);
              changed = true;
            }
          }

          if (input.labels !== undefined) {
            const current = new Set(card.labels.map((label) => label.publicId));
            const desired = new Set(desiredLabelIds);
            const toggles = desiredLabelIds.filter((id) => !current.has(id));
            if (relationMode === "replace") {
              toggles.push(...[...current].filter((id) => !desired.has(id)));
            }
            for (const labelPublicId of toggles) {
              await kanRequest(
                "PUT",
                `/cards/${card.publicId}/labels/${labelPublicId}`,
              );
              changed = true;
            }
          }

          if (input.assigneeEmails !== undefined) {
            const current = new Set(
              card.members.map((member) => member.publicId),
            );
            const desired = new Set(desiredMemberIds);
            const toggles = desiredMemberIds.filter((id) => !current.has(id));
            if (relationMode === "replace") {
              toggles.push(...[...current].filter((id) => !desired.has(id)));
            }
            for (const memberPublicId of toggles) {
              await kanRequest(
                "PUT",
                `/cards/${card.publicId}/members/${memberPublicId}`,
              );
              changed = true;
            }
          }

          for (const checklistInput of input.checklists ?? []) {
            let checklist = uniqueMatch(
              card.checklists,
              (candidate) =>
                normalized(candidate.name) === normalized(checklistInput.name),
              `checklist name "${checklistInput.name}"`,
            );
            if (!checklist) {
              const createdChecklist =
                await kanRequest<ChecklistCreateResponse>(
                  "POST",
                  `/cards/${card.publicId}/checklists`,
                  { name: checklistInput.name },
                );
              checklist = {
                ...createdChecklist,
                name: checklistInput.name,
                items: createdChecklist.items ?? [],
              };
              card.checklists.push(checklist);
              changed = true;
            }

            assertUnique(
              checklistInput.items.map((item) => item.title),
              `checklist item in ${checklistInput.name}`,
            );
            for (const itemInput of checklistInput.items) {
              const item = uniqueMatch(
                checklist.items,
                (candidate) =>
                  normalized(candidate.title) === normalized(itemInput.title),
                `checklist item "${itemInput.title}"`,
              );
              if (!item) {
                const created = await kanRequest<ChecklistItemSummary>(
                  "POST",
                  `/checklists/${checklist.publicId}/items`,
                  { title: itemInput.title },
                );
                checklist.items.push(created);
                if (itemInput.completed) {
                  await kanRequest(
                    "PATCH",
                    `/checklists/items/${created.publicId}`,
                    { completed: true },
                  );
                }
                changed = true;
              } else if (item.completed !== itemInput.completed) {
                await kanRequest(
                  "PATCH",
                  `/checklists/items/${item.publicId}`,
                  { completed: itemInput.completed },
                );
                changed = true;
              }
            }
          }

          results.push({
            title: input.title,
            publicId: card.publicId,
            status: existing ? (changed ? "updated" : "unchanged") : "created",
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          results.push({ title: input.title, status: "error", error: message });
          if (!continueOnError) throw error;
        }
      }

      return jsonResult({ mode, boardPublicId, plan, results });
    },
  );
}
