import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  HiArrowPath,
  HiCheckCircle,
  HiOutlineCloudArrowUp,
  HiOutlineExclamationCircle,
  HiXMark,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { ResourceUploadJob } from "./resource-upload-queue";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import { validateAttachmentFile } from "./attachment-upload";
import {
  canCancelResourceUploadJob,
  canDismissResourceUploadJob,
  createResourceUploadJobs,
  formatResourceSize,
  getQueuedResourceUploadIds,
  hashResourceFile,
  isResourceUploadSessionExpired,
  isVisibilityAcknowledgementError,
  prepareResourceUploadRetry,
  retainIssuedUploadSession,
  shouldUploadResourceFile,
  uploadResourceFile,
} from "./resource-upload-queue";

interface CardResourceUploadQueueProps {
  cardPublicId: string;
  disabled?: boolean;
  publicVisibilityAcknowledged?: boolean;
  onVisibilityAcknowledgementRequired?: () => void;
}

export function CardResourceUploadQueue({
  cardPublicId,
  disabled = false,
  publicVisibilityAcknowledged,
  onVisibilityAcknowledgementRequired,
}: CardResourceUploadQueueProps) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const jobsRef = useRef<ResourceUploadJob[]>([]);
  const processingRef = useRef(new Set<string>());
  const cancelledJobIdsRef = useRef(new Set<string>());
  const nonCancellableJobIdsRef = useRef(new Set<string>());
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const [jobs, setJobs] = useState<ResourceUploadJob[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [expiryClock, setExpiryClock] = useState(() => Date.now());
  const createUpload = api.cardResource.createUpload.useMutation();
  const confirmUpload = api.cardResource.confirmUpload.useMutation();

  const replaceJobs = useCallback(
    (update: (current: ResourceUploadJob[]) => ResourceUploadJob[]) => {
      setJobs((current) => {
        const next = update(current);
        jobsRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateJob = useCallback(
    (jobId: string, patch: Partial<ResourceUploadJob>) => {
      replaceJobs((current) =>
        current.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
      );
    },
    [replaceJobs],
  );

  const isCancelled = (jobId: string) =>
    cancelledJobIdsRef.current.has(jobId) ||
    jobsRef.current.find((job) => job.id === jobId)?.status === "cancelled";

  const refreshResources = useCallback(async () => {
    await Promise.all([
      utils.cardResource.list.invalidate({ cardPublicId }),
      invalidateCard(utils, cardPublicId),
      utils.board.byId.invalidate(),
    ]);
  }, [cardPublicId, utils]);

  const processJob = useCallback(
    async (jobId: string) => {
      if (processingRef.current.has(jobId)) return;
      const initialJob = jobsRef.current.find((job) => job.id === jobId);
      if (!initialJob || initialJob.status !== "queued") return;
      processingRef.current.add(jobId);

      try {
        if (isCancelled(jobId)) return;
        let currentJob = initialJob;
        let contentType = currentJob.contentType;
        if (!contentType) {
          contentType = validateAttachmentFile(currentJob.file);
          if (isCancelled(jobId)) return;
          updateJob(jobId, {
            status: "hashing",
            contentType,
            error: undefined,
          });
        }

        let sha256 = currentJob.sha256;
        if (!sha256) {
          sha256 = await hashResourceFile(currentJob.file);
          if (isCancelled(jobId)) return;
          updateJob(jobId, { sha256, status: "creating" });
        }

        currentJob =
          jobsRef.current.find((job) => job.id === jobId) ?? currentJob;
        let session = currentJob.session;
        if (session && isResourceUploadSessionExpired(session)) {
          currentJob = prepareResourceUploadRetry(currentJob);
          updateJob(jobId, {
            session: undefined,
            uploadComplete: undefined,
            progress: 0,
          });
          session = undefined;
        }
        if (!session) {
          nonCancellableJobIdsRef.current.add(jobId);
          const issuedSession = await createUpload
            .mutateAsync({
              cardPublicId,
              filename: currentJob.file.name,
              contentType,
              size: currentJob.file.size,
              sha256,
              publicVisibilityAcknowledged,
            })
            .finally(() => nonCancellableJobIdsRef.current.delete(jobId));
          session = issuedSession;
          currentJob = retainIssuedUploadSession(
            currentJob,
            issuedSession,
            isCancelled(jobId),
          );
          let cancelledWhileCreating = currentJob.status === "cancelled";
          replaceJobs((current) =>
            current.map((job) => {
              if (job.id !== jobId) return job;
              const next = retainIssuedUploadSession(
                job,
                issuedSession,
                isCancelled(jobId),
              );
              cancelledWhileCreating = next.status === "cancelled";
              return next;
            }),
          );
          if (cancelledWhileCreating) return;
        }

        if (shouldUploadResourceFile(currentJob)) {
          const controller = new AbortController();
          abortControllersRef.current.set(jobId, controller);
          updateJob(jobId, { status: "uploading", progress: 0 });
          await uploadResourceFile(
            session.url,
            currentJob.file,
            contentType,
            controller.signal,
            (progress) => updateJob(jobId, { progress }),
          );
          abortControllersRef.current.delete(jobId);
          if (isCancelled(jobId)) return;
          updateJob(jobId, {
            uploadComplete: true,
            progress: 100,
            status: "confirming",
          });
        } else {
          updateJob(jobId, { progress: 100, status: "confirming" });
        }

        nonCancellableJobIdsRef.current.add(jobId);
        await confirmUpload
          .mutateAsync({
            cardPublicId,
            uploadSessionPublicId: session.uploadSessionPublicId,
            publicVisibilityAcknowledged,
          })
          .finally(() => nonCancellableJobIdsRef.current.delete(jobId));
        updateJob(jobId, { status: "complete", progress: 100 });
        try {
          await refreshResources();
        } catch {
          showPopup({
            header: t`File uploaded`,
            message: t`The file is safe, but the resource list could not be refreshed.`,
            icon: "success",
          });
        }
      } catch (error) {
        abortControllersRef.current.delete(jobId);
        if (
          isCancelled(jobId) ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          updateJob(jobId, { status: "cancelled" });
        } else if (isVisibilityAcknowledgementError(error)) {
          updateJob(jobId, { status: "error", error: "visibility" });
          onVisibilityAcknowledgementRequired?.();
        } else {
          updateJob(jobId, { status: "error", error: "network" });
          showPopup({
            header: t`Upload failed`,
            message: t`The upload session is still available. Retry to continue without reserving another upload.`,
            icon: "error",
          });
        }
      } finally {
        processingRef.current.delete(jobId);
        replaceJobs((current) => [...current]);
      }
    },
    [
      cardPublicId,
      confirmUpload,
      createUpload,
      publicVisibilityAcknowledged,
      onVisibilityAcknowledgementRequired,
      refreshResources,
      replaceJobs,
      showPopup,
      updateJob,
    ],
  );

  useEffect(() => {
    if (disabled) return;
    for (const jobId of getQueuedResourceUploadIds(jobs)) {
      void processJob(jobId);
    }
  }, [disabled, jobs, processJob]);

  useEffect(
    () => () => {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
    },
    [],
  );

  useEffect(() => {
    const nextExpiry = jobs.reduce<number | null>((earliest, job) => {
      if (!job.session || job.status === "complete") return earliest;
      const expiry = job.session.expiresAt.getTime();
      return earliest === null ? expiry : Math.min(earliest, expiry);
    }, null);
    if (nextExpiry === null) return;

    const timeout = window.setTimeout(
      () => setExpiryClock(Date.now()),
      Math.max(0, nextExpiry - Date.now()) + 25,
    );
    return () => window.clearTimeout(timeout);
  }, [jobs]);

  const addFiles = (files: File[]) => {
    if (disabled || files.length === 0) return;
    replaceJobs((current) => [
      ...current.filter((job) => job.status !== "complete"),
      ...createResourceUploadJobs(files),
    ]);
  };

  const retry = (jobId: string) => {
    cancelledJobIdsRef.current.delete(jobId);
    const job = jobsRef.current.find((candidate) => candidate.id === jobId);
    if (!job) return;
    replaceJobs((current) =>
      current.map((candidate) =>
        candidate.id === jobId
          ? prepareResourceUploadRetry(candidate)
          : candidate,
      ),
    );
  };

  const cancel = (jobId: string) => {
    if (nonCancellableJobIdsRef.current.has(jobId)) return;
    cancelledJobIdsRef.current.add(jobId);
    abortControllersRef.current.get(jobId)?.abort();
    updateJob(jobId, { status: "cancelled" });
  };

  const remove = (jobId: string) => {
    cancelledJobIdsRef.current.delete(jobId);
    replaceJobs((current) => current.filter((job) => job.id !== jobId));
  };

  const statusLabel = (job: ResourceUploadJob) => {
    if (job.status === "queued") return t`Waiting`;
    if (job.status === "hashing") return t`Securing file…`;
    if (job.status === "creating") return t`Preparing upload…`;
    if (job.status === "uploading") return t`Uploading · ${job.progress}%`;
    if (job.status === "confirming") return t`Verifying file…`;
    if (job.status === "complete") return t`Uploaded`;
    if (job.status === "cancelled") return t`Cancelled`;
    if (job.error === "empty") return t`The file is empty`;
    if (job.error === "name-too-long")
      return t`The file name is longer than 255 characters`;
    if (job.error === "too-large") return t`The file is larger than 50 MiB`;
    if (job.error === "unsupported") return t`This file type is not supported`;
    if (job.error === "visibility")
      return t`Confirm public visibility, then retry this upload`;
    return t`Upload failed`;
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setIsDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className={twMerge(
          "flex w-full items-center gap-4 rounded-lg border border-dashed border-light-500 px-4 py-4 text-left transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:border-dark-500 dark:focus-visible:ring-dark-800 sm:px-5",
          isDragging &&
            "border-light-900 bg-light-100 dark:border-dark-900 dark:bg-dark-200",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "hover:border-light-800 hover:bg-light-100 dark:hover:border-dark-800 dark:hover:bg-dark-200",
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-light-400 text-light-800 dark:border-dark-500 dark:text-dark-800">
          <HiOutlineCloudArrowUp className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`Upload files`}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-light-700 dark:text-dark-700">
            {t`Choose several files or drop them here · maximum 50 MiB each`}
          </span>
        </span>
      </button>

      {jobs.length > 0 && (
        <div
          className="mt-3 divide-y divide-light-300 border-y border-light-300 dark:divide-dark-400 dark:border-dark-400"
          aria-live="polite"
        >
          {jobs.map((job) => {
            const canCancel = canCancelResourceUploadJob(job);
            const canRetry =
              ["cancelled", "error"].includes(job.status) &&
              !["empty", "name-too-long", "too-large", "unsupported"].includes(
                job.error ?? "",
              );
            const canDismiss = canDismissResourceUploadJob(job, expiryClock);
            return (
              <div
                key={job.id}
                className="flex min-w-0 items-center gap-3 py-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-light-200 text-light-800 dark:bg-dark-200 dark:text-dark-800">
                  {job.status === "complete" ? (
                    <HiCheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : job.status === "error" ? (
                    <HiOutlineExclamationCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  ) : (
                    <HiOutlineCloudArrowUp className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium text-light-1000 dark:text-dark-1000">
                      {job.file.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-light-700 dark:text-dark-700">
                      {formatResourceSize(job.file.size)}
                    </span>
                  </div>
                  <p
                    className={twMerge(
                      "mt-0.5 text-[11px] text-light-700 dark:text-dark-700",
                      job.status === "error" &&
                        "text-red-600 dark:text-red-400",
                    )}
                  >
                    {statusLabel(job)}
                  </p>
                  {["uploading", "confirming", "complete"].includes(
                    job.status,
                  ) && (
                    <div
                      role="progressbar"
                      aria-label={t`Upload progress for ${job.file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={job.progress}
                      className="mt-1.5 h-1 overflow-hidden rounded-full bg-light-300 dark:bg-dark-400"
                    >
                      <div
                        className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}
                </div>
                {canRetry && (
                  <button
                    type="button"
                    onClick={() => retry(job.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                    aria-label={t`Retry ${job.file.name}`}
                  >
                    <HiArrowPath className="h-4 w-4" />
                  </button>
                )}
                {!["creating", "confirming"].includes(job.status) &&
                  (canCancel || canDismiss) && (
                    <button
                      type="button"
                      onClick={() =>
                        canCancel ? cancel(job.id) : remove(job.id)
                      }
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-light-700 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                      aria-label={
                        canCancel
                          ? t`Cancel ${job.file.name}`
                          : t`Dismiss ${job.file.name}`
                      }
                    >
                      <HiXMark className="h-4 w-4" />
                    </button>
                  )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
