import { beforeEach, describe, expect, it, vi } from "vitest";

import * as notificationRepo from "@kan/db/repository/notification.repo";

vi.mock("@kan/db/repository/notification.repo", () => ({
  getUnreadCount: vi.fn(),
  list: vi.fn(),
  markAllAsRead: vi.fn(),
  markAsRead: vi.fn(),
  syncDueAlerts: vi.fn(),
}));

const mockList = notificationRepo.list as ReturnType<typeof vi.fn>;
const mockMarkAsRead = notificationRepo.markAsRead as ReturnType<typeof vi.fn>;
const mockMarkAllAsRead = notificationRepo.markAllAsRead as ReturnType<
  typeof vi.fn
>;
const mockGetUnreadCount = notificationRepo.getUnreadCount as ReturnType<
  typeof vi.fn
>;
const mockSyncDueAlerts = notificationRepo.syncDueAlerts as ReturnType<
  typeof vi.fn
>;

describe("notification router", () => {
  const db = {} as never;
  const user = {
    id: "70c36a50-c047-4540-aa6d-c81d6ff2455d",
    name: "Current User",
    email: "current@example.com",
  };
  const context = { db, user } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only the current user's page and preserves a stable cursor", async () => {
    const createdAt = new Date("2026-08-20T12:00:00.000Z");
    mockList
      .mockResolvedValueOnce({
        items: [
          {
            publicId: "notice000001",
            type: "card.due.soon",
            createdAt,
            readAt: null,
            card: {
              publicId: "card00000001",
              title: "Ship alerts",
              boardName: "Gerencia",
              workspacePublicId: "workspc00001",
            },
          },
        ],
        nextCursor: { publicId: "notice000001" },
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const { notificationRouter } = await import("./notification");
    const caller = notificationRouter.createCaller(context);

    const firstPage = await caller.list({ limit: 1 });
    expect(firstPage.nextCursor).not.toBeNull();
    if (!firstPage.nextCursor) throw new Error("Expected a next cursor");
    const secondPage = await caller.list({
      limit: 1,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.items[0]?.card?.boardName).toBe("Gerencia");
    expect(secondPage).toEqual({ items: [], nextCursor: null });
    expect(mockList).toHaveBeenNthCalledWith(1, db, {
      userId: user.id,
      limit: 1,
      cursor: undefined,
    });
    expect(mockList).toHaveBeenNthCalledWith(2, db, {
      userId: user.id,
      limit: 1,
      cursor: { publicId: "notice000001" },
    });
  });

  it("rejects malformed cursors before reading notifications", async () => {
    const { notificationRouter } = await import("./notification");

    await expect(
      notificationRouter.createCaller(context).list({ cursor: "invalid" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockList).not.toHaveBeenCalled();
  });

  it("marks a notification by public ID and authenticated owner", async () => {
    const readAt = new Date("2026-08-20T12:05:00.000Z");
    mockMarkAsRead.mockResolvedValue({
      publicId: "notice000001",
      readAt,
    });
    const { notificationRouter } = await import("./notification");

    const result = await notificationRouter.createCaller(context).markRead({
      notificationPublicId: "notice000001",
    });

    expect(result).toEqual({ publicId: "notice000001", readAt });
    expect(mockMarkAsRead).toHaveBeenCalledWith(db, {
      notificationPublicId: "notice000001",
      userId: user.id,
    });
  });

  it("does not reveal a notification owned by another user", async () => {
    mockMarkAsRead.mockResolvedValue(null);
    const { notificationRouter } = await import("./notification");

    await expect(
      notificationRouter.createCaller(context).markRead({
        notificationPublicId: "notice000002",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns unread, bulk-read, and synchronization counts", async () => {
    mockGetUnreadCount.mockResolvedValue(4);
    mockMarkAllAsRead.mockResolvedValue(4);
    mockSyncDueAlerts.mockResolvedValue({ created: 1, invalidated: 2 });
    const { notificationRouter } = await import("./notification");
    const caller = notificationRouter.createCaller(context);

    await expect(caller.unreadCount()).resolves.toEqual({ count: 4 });
    await expect(caller.markAllRead()).resolves.toEqual({ count: 4 });
    await expect(caller.syncDueAlerts()).resolves.toEqual({
      created: 1,
      invalidated: 2,
    });
    expect(mockGetUnreadCount).toHaveBeenCalledWith(db, user.id);
    expect(mockMarkAllAsRead).toHaveBeenCalledWith(db, user.id);
    expect(mockSyncDueAlerts).toHaveBeenCalledWith(db, { userId: user.id });
  });

  it("requires authentication for every endpoint", async () => {
    const { notificationRouter } = await import("./notification");
    const caller = notificationRouter.createCaller({ db, user: null } as never);

    await expect(caller.list({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.unreadCount()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.syncDueAlerts()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.markRead({ notificationPublicId: "notice000001" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.markAllRead()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
