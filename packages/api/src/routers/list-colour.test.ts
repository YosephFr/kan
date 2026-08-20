import { describe, expect, it } from "vitest";

import { listRouter } from "./list";

describe("list colour validation", () => {
  it("rejects colours outside the product palette before querying data", async () => {
    const caller = listRouter.createCaller({
      user: { id: "user-123" },
      db: {},
    } as never);

    await expect(
      caller.update({
        listPublicId: "list-1234567",
        colourCode: "#ffffff",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
