import { t } from "@lingui/core/macro";
import { useRef, useState } from "react";
import { HiOutlinePaperClip } from "react-icons/hi";
import { HiCheckBadge } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import Button from "~/components/Button";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import {
  AttachmentValidationError,
  prepareAttachmentUpload,
} from "./attachment-upload";

export function AttachmentUpload({ cardPublicId }: { cardPublicId: string }) {
  const { openModal } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const createUploadSession = api.attachment.generateUploadUrl.useMutation();
  const confirmUpload = api.attachment.confirm.useMutation();

  const uploadFile = async (file: File) => {
    setUploading(true);

    try {
      const { contentType, uploadSession } = await prepareAttachmentUpload(
        file,
        cardPublicId,
        (input) => createUploadSession.mutateAsync(input),
      );
      const response = await fetch(uploadSession.url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      await confirmUpload.mutateAsync({
        cardPublicId,
        uploadSessionPublicId: uploadSession.uploadSessionPublicId,
      });

      await invalidateCard(utils, cardPublicId);
      showPopup({
        header: t`Attachment uploaded`,
        message: t`Your file has been uploaded successfully.`,
        icon: "success",
      });
    } catch (error) {
      showPopup({
        header: t`Upload failed`,
        message:
          error instanceof AttachmentValidationError
            ? error.code === "unsupported"
              ? t`This file type is not supported.`
              : t`Attachments must be between 1 byte and 50 MiB.`
            : t`Failed to upload attachment. Please try again.`,
        icon: "error",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    event.target.value = "";

    await uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (uploading) return;

    const file = e.dataTransfer.files[0];
    if (!file) return;

    await uploadFile(file);
  };

  return (
    <div className="mb-6">
      <input
        ref={inputRef}
        type="file"
        id="attachment-upload"
        className="hidden"
        onChange={handleFileSelect}
        disabled={uploading}
      />
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={twMerge(
          "rounded-lg border-2 border-dashed transition-colors",
          isDragging
            ? "border-light-300 bg-light-100 dark:border-dark-300 dark:bg-dark-100"
            : "border-transparent",
        )}
      >
        <div className="flex items-center justify-between p-2">
          <Button
            type="button"
            variant="ghost"
            iconLeft={
              <HiCheckBadge className="h-4 w-4 text-light-950 dark:text-dark-950" />
            }
            iconOnly
            size="sm"
            aria-label={t`Add checklist`}
            onClick={() => openModal("ADD_CHECKLIST")}
          />
          <Button
            type="button"
            variant="ghost"
            iconLeft={
              <HiOutlinePaperClip className="h-4 w-4 text-light-950 dark:text-dark-950" />
            }
            isLoading={uploading}
            disabled={uploading}
            iconOnly
            size="sm"
            aria-label={t`Upload attachment`}
            onClick={() => inputRef.current?.click()}
          />
        </div>
      </div>
    </div>
  );
}
