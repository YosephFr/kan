import { describe, expect, it, vi } from "vitest";

import {
  canCancelResourceUploadJob,
  canDismissResourceUploadJob,
  createResourceUploadJobs,
  formatResourceSize,
  getQueuedResourceUploadIds,
  prepareResourceUploadRetry,
  retainIssuedUploadSession,
  shouldUploadResourceFile,
} from "./resource-upload-queue";

const file = (name: string) =>
  new File(["content"], name, { type: "text/plain" });

describe("resource upload queue", () => {
  it("starts no more than three uploads", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "upload-id") });
    const jobs = ["one.txt", "two.txt", "three.txt", "four.txt"].map(
      (name, index) => ({
        id: String(index),
        file: file(name),
        status: "queued" as const,
        progress: 0,
      }),
    );
    const [firstJob, ...remainingJobs] = jobs;
    if (!firstJob) throw new Error("Expected a queued upload job");

    expect(getQueuedResourceUploadIds(jobs)).toEqual(["0", "1", "2"]);
    expect(
      getQueuedResourceUploadIds([
        { ...firstJob, status: "uploading" },
        ...remainingJobs,
      ]),
    ).toEqual(["1", "2"]);
  });

  it("marks invalid files without blocking valid files", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "upload-id") });
    const jobs = createResourceUploadJobs([
      file("valid.txt"),
      new File([], "empty.txt", { type: "text/plain" }),
    ]);

    expect(jobs.map((job) => job.status)).toEqual(["queued", "error"]);
    expect(jobs[1]?.error).toBe("empty");
  });

  it("rejects file names that the upload contract cannot store", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "upload-id") });
    const [job] = createResourceUploadJobs([file(`${"a".repeat(252)}.txt`)]);

    expect(job?.status).toBe("error");
    expect(job?.error).toBe("name-too-long");
  });

  it("formats resource sizes compactly", () => {
    expect(formatResourceSize(800)).toBe("800 B");
    expect(formatResourceSize(1536)).toBe("1.5 KB");
    expect(formatResourceSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("retains an issued session when cancellation wins the race", () => {
    const cancelled = {
      id: "cancelled",
      file: file("cancelled.txt"),
      status: "cancelled" as const,
      progress: 0,
    };
    const session = {
      url: "https://storage.invalid/signed",
      uploadSessionPublicId: "session000001",
      expiresAt: new Date(Date.now() + 60_000),
    };

    const retained = retainIssuedUploadSession(cancelled, session);

    expect(retained.status).toBe("cancelled");
    expect(retained.session).toEqual(session);
  });

  it("retains a session when cancellation is recorded before React state", () => {
    const queued = {
      id: "queued",
      file: file("queued.txt"),
      status: "queued" as const,
      progress: 0,
    };
    const session = {
      url: "https://storage.invalid/signed",
      uploadSessionPublicId: "session000001",
      expiresAt: new Date(Date.now() + 60_000),
    };

    expect(retainIssuedUploadSession(queued, session, true)).toMatchObject({
      status: "cancelled",
      session,
    });
  });

  it("does not discard an issued upload capability", () => {
    const job = {
      id: "issued",
      file: file("issued.txt"),
      status: "error" as const,
      progress: 45,
      session: {
        url: "https://storage.invalid/signed",
        uploadSessionPublicId: "session000001",
        expiresAt: new Date(Date.now() + 60_000),
      },
    };

    expect(canDismissResourceUploadJob(job)).toBe(false);
    expect(canDismissResourceUploadJob({ ...job, status: "complete" })).toBe(
      true,
    );
  });

  it("retries confirmation without another PUT after upload completes", () => {
    const session = {
      url: "https://storage.invalid/signed",
      uploadSessionPublicId: "session000001",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const job = {
      id: "uploaded",
      file: file("uploaded.txt"),
      status: "error" as const,
      progress: 100,
      session,
      uploadComplete: true,
      error: "visibility" as const,
    };
    const retry = prepareResourceUploadRetry(job);

    expect(retry).toMatchObject({
      status: "queued",
      session,
      uploadComplete: true,
      progress: 100,
    });
    expect(shouldUploadResourceFile(retry)).toBe(false);
    expect(canCancelResourceUploadJob(job)).toBe(false);
  });

  it("reuses an unexpired issued session after an upload error", () => {
    const session = {
      url: "https://storage.invalid/signed",
      uploadSessionPublicId: "session000001",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const retry = prepareResourceUploadRetry({
      id: "failed-put",
      file: file("failed-put.txt"),
      status: "error",
      progress: 42,
      session,
      error: "network",
    });

    expect(retry.session).toBe(session);
    expect(shouldUploadResourceFile(retry)).toBe(true);
  });

  it("preserves a session before expiry and replaces it afterwards", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
    const job = {
      id: "expiring",
      file: file("expiring.txt"),
      status: "error" as const,
      progress: 100,
      uploadComplete: true,
      session: {
        url: "https://storage.invalid/signed",
        uploadSessionPublicId: "session000001",
        expiresAt: new Date("2026-08-21T12:01:00.000Z"),
      },
    };

    expect(prepareResourceUploadRetry(job).session).toBe(job.session);
    expect(canDismissResourceUploadJob(job)).toBe(false);

    vi.advanceTimersByTime(60_000);

    expect(prepareResourceUploadRetry(job)).toMatchObject({
      status: "queued",
      progress: 0,
      session: undefined,
      uploadComplete: undefined,
    });
    expect(canDismissResourceUploadJob(job)).toBe(true);
    vi.useRealTimers();
  });
});
