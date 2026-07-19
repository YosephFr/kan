import { afterEach, describe, expect, it } from "vitest";

import { isInstanceAdminEmail } from "./instanceAdmin";

const originalInstanceAdminEmails = process.env.INSTANCE_ADMIN_EMAILS;

afterEach(() => {
  if (originalInstanceAdminEmails === undefined) {
    delete process.env.INSTANCE_ADMIN_EMAILS;
  } else {
    process.env.INSTANCE_ADMIN_EMAILS = originalInstanceAdminEmails;
  }
});

describe("isInstanceAdminEmail", () => {
  it("rejects users when no administrator is configured", () => {
    delete process.env.INSTANCE_ADMIN_EMAILS;
    expect(isInstanceAdminEmail("franco@imanleads.com")).toBe(false);
  });

  it("matches configured emails without case sensitivity", () => {
    process.env.INSTANCE_ADMIN_EMAILS =
      "owner@example.com, Franco@Imanleads.com ";
    expect(isInstanceAdminEmail("franco@imanleads.com")).toBe(true);
    expect(isInstanceAdminEmail("someone@example.com")).toBe(false);
  });
});
