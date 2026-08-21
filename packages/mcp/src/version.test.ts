import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { mcpVersion } from "./constants.js";

describe("MCP version", () => {
  it("matches the published package version", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };

    expect(mcpVersion).toBe(packageJson.version);
  });
});
