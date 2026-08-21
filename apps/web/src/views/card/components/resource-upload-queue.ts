import { validateAttachmentFile } from "./attachment-upload";

export const MAX_CONCURRENT_RESOURCE_UPLOADS = 3;

export type ResourceUploadStatus =
  | "queued"
  | "hashing"
  | "creating"
  | "uploading"
  | "confirming"
  | "complete"
  | "cancelled"
  | "error";

export interface ResourceUploadSession {
  url: string;
  uploadSessionPublicId: string;
  expiresAt: Date;
}

export interface ResourceUploadJob {
  id: string;
  file: File;
  status: ResourceUploadStatus;
  progress: number;
  contentType?: string;
  sha256?: string;
  session?: ResourceUploadSession;
  uploadComplete?: boolean;
  error?:
    | "empty"
    | "name-too-long"
    | "too-large"
    | "unsupported"
    | "network"
    | "visibility";
}

const ACTIVE_UPLOAD_STATUSES: ResourceUploadStatus[] = [
  "hashing",
  "creating",
  "uploading",
  "confirming",
];

export function getQueuedResourceUploadIds(
  jobs: ResourceUploadJob[],
  concurrency = MAX_CONCURRENT_RESOURCE_UPLOADS,
): string[] {
  const activeCount = jobs.filter((job) =>
    ACTIVE_UPLOAD_STATUSES.includes(job.status),
  ).length;

  return jobs
    .filter((job) => job.status === "queued")
    .slice(0, Math.max(0, concurrency - activeCount))
    .map((job) => job.id);
}

export function createResourceUploadJobs(files: File[]): ResourceUploadJob[] {
  return files.map((file) => {
    const id = crypto.randomUUID();
    try {
      validateAttachmentFile(file);
      return { id, file, status: "queued", progress: 0 };
    } catch (error) {
      const code =
        error instanceof Error &&
        ["empty", "name-too-long", "too-large", "unsupported"].includes(
          error.message,
        )
          ? (error.message as
              | "empty"
              | "name-too-long"
              | "too-large"
              | "unsupported")
          : "unsupported";
      return {
        id,
        file,
        status: "error",
        progress: 0,
        error: code,
      };
    }
  });
}

export function retainIssuedUploadSession(
  job: ResourceUploadJob,
  session: ResourceUploadSession,
  cancelled = job.status === "cancelled",
): ResourceUploadJob {
  return {
    ...job,
    session,
    status: cancelled ? "cancelled" : "uploading",
  };
}

export function isResourceUploadSessionExpired(
  session: ResourceUploadSession,
  now = Date.now(),
): boolean {
  return session.expiresAt.getTime() <= now;
}

export function canDismissResourceUploadJob(
  job: ResourceUploadJob,
  now = Date.now(),
): boolean {
  return (
    !job.session ||
    isResourceUploadSessionExpired(job.session, now) ||
    job.status === "complete"
  );
}

export function canCancelResourceUploadJob(job: ResourceUploadJob): boolean {
  return (
    !job.uploadComplete &&
    ["queued", "hashing", "uploading"].includes(job.status)
  );
}

export function shouldUploadResourceFile(job: ResourceUploadJob): boolean {
  return !job.uploadComplete;
}

export function prepareResourceUploadRetry(
  job: ResourceUploadJob,
  now = Date.now(),
): ResourceUploadJob {
  const sessionExpired =
    job.session && isResourceUploadSessionExpired(job.session, now);
  return {
    ...job,
    status: "queued",
    error: undefined,
    progress: sessionExpired ? 0 : job.uploadComplete ? 100 : 0,
    session: sessionExpired ? undefined : job.session,
    uploadComplete: sessionExpired ? undefined : job.uploadComplete,
  };
}

export function isVisibilityAcknowledgementError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED")
  );
}

export function formatResourceSize(size: number | null | undefined): string {
  if (!size || size < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  );
  const value = size / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function uploadResourceFile(
  url: string,
  file: File,
  contentType: string,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();

    request.open("PUT", url);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      signal.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error("network"));
    });
    request.addEventListener("error", () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("network"));
    });
    request.addEventListener("abort", () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Upload cancelled", "AbortError"));
    });

    signal.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
}

export async function hashResourceFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const worker = new Worker(
    new URL("./resource-hash.worker.ts", import.meta.url),
    { type: "module" },
  );

  return new Promise((resolve, reject) => {
    worker.addEventListener(
      "message",
      (event: MessageEvent<{ sha256?: string; error?: string }>) => {
        worker.terminate();
        if (event.data.sha256) resolve(event.data.sha256);
        else reject(new Error(event.data.error ?? "hash"));
      },
      { once: true },
    );
    worker.addEventListener(
      "error",
      () => {
        worker.terminate();
        reject(new Error("hash"));
      },
      { once: true },
    );
    worker.postMessage(buffer, [buffer]);
  });
}
