import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import Button from "~/components/Button";
import { usePopup } from "~/providers/popup";
import { WorkspaceLogo } from "./WorkspaceLogo";

const allowedContentTypes = ["image/jpeg", "image/png", "image/webp"];

export function WorkspaceLogoPicker({
  workspaceName,
  currentLogo,
  selectedFile,
  onFileSelect,
  onRemove,
  disabled = false,
  isRemoving = false,
}: {
  workspaceName: string;
  currentLogo?: string | null;
  selectedFile?: File | null;
  onFileSelect: (file: File | null) => void;
  onRemove?: () => void;
  disabled?: boolean;
  isRemoving?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { showPopup } = usePopup();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) return;
    if (!allowedContentTypes.includes(file.type)) {
      showPopup({
        header: t`Unable to use this image`,
        message: t`Choose a PNG, JPG, or WebP image.`,
        icon: "error",
      });
      return;
    }

    onFileSelect(file);
  };

  const displayedLogo = previewUrl ?? currentLogo;

  return (
    <div className="flex max-w-xl items-center gap-4">
      <WorkspaceLogo
        name={workspaceName || t`Workspace`}
        logo={displayedLogo}
        size="lg"
      />
      <div className="min-w-0">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
          disabled={disabled}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            {displayedLogo ? t`Change image` : t`Upload image`}
          </Button>
          {selectedFile && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onFileSelect(null)}
              disabled={disabled}
            >
              {t`Discard`}
            </Button>
          )}
          {!selectedFile && currentLogo && onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={disabled || isRemoving}
              isLoading={isRemoving}
            >
              {t`Remove`}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-light-900 dark:text-dark-900">
          {t`PNG, JPG, or WebP. Square images work best.`}
        </p>
      </div>
    </div>
  );
}
