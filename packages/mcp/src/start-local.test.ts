import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const pathVariableName = ["PA", "TH"].join("");

async function createLauncherFixture() {
  const root = await mkdtemp(join(tmpdir(), "kan-mcp-launcher-"));
  const mcpDirectory = join(root, "packages", "mcp");
  const scriptDirectory = join(mcpDirectory, "bin");
  const stubDirectory = join(root, "stub-bin");
  await mkdir(join(mcpDirectory, "src"), { recursive: true });
  await mkdir(scriptDirectory, { recursive: true });
  await mkdir(stubDirectory, { recursive: true });
  const launcher = await readFile(
    new URL("../bin/start-local.sh", import.meta.url),
    "utf8",
  );
  const launcherPath = join(scriptDirectory, "start-local.sh");
  await writeFile(launcherPath, launcher, { mode: 0o755 });
  await writeFile(join(mcpDirectory, "src", "index.ts"), "export {};\n");
  await writeFile(join(mcpDirectory, "package.json"), "{}\n");
  await writeFile(join(mcpDirectory, "tsconfig.json"), "{}\n");
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  await writeFile(
    join(root, ".env.kan-mcp.local"),
    "KAN_BASE_URL=https://kan.test\nKAN_API_TOKEN=test-token\n",
  );
  await writeFile(
    join(stubDirectory, "pnpm"),
    `#!/bin/sh
set -eu
out_dir=""
mcp_dir=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--dir" ]; then
    mcp_dir=$2
    shift 2
    continue
  fi
  if [ "$1" = "--outDir" ]; then
    out_dir=$2
    break
  fi
  shift
done
test -n "$out_dir"
mkdir -p "$out_dir"
printf '%s\n' 'process.exit(0);' > "$out_dir/index.js"
if [ -n "\${KAN_MCP_TEST_REPLACE_LOCK_OWNER_PID:-}" ]; then
  test -n "$mcp_dir"
  printf '%s\n' "$KAN_MCP_TEST_REPLACE_LOCK_OWNER_PID" > "$mcp_dir/.dist-build.lock/owner.pid"
fi
`,
    { mode: 0o755 },
  );

  return {
    launcherPath,
    lockDirectory: join(mcpDirectory, ".dist-build.lock"),
    mcpDirectory,
    root,
    stubDirectory,
  };
}

function launcherEnvironment(
  stubDirectory: string,
  overrides: Record<string, string> = {},
) {
  return {
    ...process.env,
    PATH: `${stubDirectory}:${process.env[pathVariableName] ?? ""}`,
    ...overrides,
  };
}

async function expectLauncherTimeout(
  launcherPath: string,
  stubDirectory: string,
) {
  const failure = await execFileAsync("bash", [launcherPath], {
    env: launcherEnvironment(stubDirectory, {
      KAN_MCP_LAUNCHER_TEST_MODE: "1",
      KAN_MCP_TEST_LOCK_ATTEMPTS: "2",
      KAN_MCP_TEST_LOCK_SLEEP_SECONDS: "0.01",
    }),
  }).then(
    () => null,
    (error: unknown) => error,
  );
  if (
    !failure ||
    typeof failure !== "object" ||
    !("stderr" in failure) ||
    typeof failure.stderr !== "string"
  ) {
    throw new Error("Expected launcher failure with stderr");
  }
  expect(failure.stderr).toContain("Timed out waiting");
}

async function launcherFailureStderr(
  launcherPath: string,
  stubDirectory: string,
  overrides: Record<string, string>,
) {
  const failure = await execFileAsync("bash", [launcherPath], {
    env: launcherEnvironment(stubDirectory, overrides),
  }).then(
    () => null,
    (error: unknown) => error,
  );
  if (
    !failure ||
    typeof failure !== "object" ||
    !("stderr" in failure) ||
    typeof failure.stderr !== "string"
  ) {
    throw new Error("Expected launcher failure with stderr");
  }
  return failure.stderr;
}

describe("local MCP launcher", () => {
  it("rebuilds stale source into a temporary directory before swapping dist", async () => {
    const script = await readFile(
      new URL("../bin/start-local.sh", import.meta.url),
      "utf8",
    );

    expect(script).toContain('-newer "$entrypoint"');
    expect(script).toContain('mktemp -d "$mcp_dir/.dist-build.XXXXXX"');
    expect(script).toContain('mv "$build_dir" "$dist_dir"');
    expect(script).not.toContain(
      'pnpm --dir "$repo_dir" --filter @kan/mcp build',
    );
  });

  it("releases the build lock before executing the rebuilt server", async () => {
    const fixture = await createLauncherFixture();
    try {
      await execFileAsync("bash", [fixture.launcherPath], {
        env: launcherEnvironment(fixture.stubDirectory),
      });

      await expect(access(fixture.lockDirectory)).rejects.toThrow();
      await expect(
        access(join(fixture.mcpDirectory, "dist", "index.js")),
      ).resolves.toBe(undefined);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("recovers a build lock whose owner PID no longer exists", async () => {
    const fixture = await createLauncherFixture();
    try {
      await mkdir(fixture.lockDirectory);
      await writeFile(join(fixture.lockDirectory, "owner.pid"), "99999999\n");

      await execFileAsync("bash", [fixture.launcherPath], {
        env: launcherEnvironment(fixture.stubDirectory),
      });

      await expect(access(fixture.lockDirectory)).rejects.toThrow();
      await expect(
        access(join(fixture.mcpDirectory, "dist", "index.js")),
      ).resolves.toBe(undefined);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not steal a build lock from a live owner PID", async () => {
    const fixture = await createLauncherFixture();
    try {
      await mkdir(fixture.lockDirectory);
      await writeFile(
        join(fixture.lockDirectory, "owner.pid"),
        `${process.pid}\n`,
      );

      await expectLauncherTimeout(fixture.launcherPath, fixture.stubDirectory);
      await expect(access(fixture.lockDirectory)).resolves.toBe(undefined);
      await expect(
        readFile(join(fixture.lockDirectory, "owner.pid"), "utf8"),
      ).resolves.toBe(`${process.pid}\n`);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not steal an ownerless lock during its creation window", async () => {
    const fixture = await createLauncherFixture();
    try {
      await mkdir(fixture.lockDirectory);

      await expectLauncherTimeout(fixture.launcherPath, fixture.stubDirectory);

      await expect(access(fixture.lockDirectory)).resolves.toBe(undefined);
      await expect(
        access(join(fixture.lockDirectory, "owner.pid")),
      ).rejects.toThrow();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("recovers an ownerless lock only after the grace window", async () => {
    const fixture = await createLauncherFixture();
    try {
      await mkdir(fixture.lockDirectory);
      const oldTimestamp = new Date(Date.now() - 31_000);
      await utimes(fixture.lockDirectory, oldTimestamp, oldTimestamp);

      await execFileAsync("bash", [fixture.launcherPath], {
        env: launcherEnvironment(fixture.stubDirectory),
      });

      await expect(access(fixture.lockDirectory)).rejects.toThrow();
      await expect(
        access(join(fixture.mcpDirectory, "dist", "index.js")),
      ).resolves.toBe(undefined);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not swap dist after losing ownership during the build", async () => {
    const fixture = await createLauncherFixture();
    try {
      const distDirectory = join(fixture.mcpDirectory, "dist");
      const entrypoint = join(distDirectory, "index.js");
      const source = join(fixture.mcpDirectory, "src", "index.ts");
      await mkdir(distDirectory);
      await writeFile(entrypoint, "original bundle\n");
      const newerTimestamp = new Date(Date.now() + 2_000);
      await utimes(source, newerTimestamp, newerTimestamp);

      const stderr = await launcherFailureStderr(
        fixture.launcherPath,
        fixture.stubDirectory,
        { KAN_MCP_TEST_REPLACE_LOCK_OWNER_PID: `${process.pid}` },
      );

      expect(stderr).toContain("Lost ownership of the MCP build lock");
      await expect(readFile(entrypoint, "utf8")).resolves.toBe(
        "original bundle\n",
      );
      await expect(
        readFile(join(fixture.lockDirectory, "owner.pid"), "utf8"),
      ).resolves.toBe(`${process.pid}\n`);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
