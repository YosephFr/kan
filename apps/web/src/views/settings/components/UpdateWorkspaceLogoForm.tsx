import { t } from "@lingui/core/macro";
import { useState } from "react";

import Button from "~/components/Button";
import { WorkspaceLogoPicker } from "~/components/WorkspaceLogoPicker";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

export default function UpdateWorkspaceLogoForm({
  workspacePublicId,
  workspaceName,
  workspaceLogo,
  disabled = false,
}: {
  workspacePublicId: string;
  workspaceName: string;
  workspaceLogo?: string | null;
  disabled?: boolean;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const { showPopup } = usePopup();
  const utils = api.useUtils();

  const refreshWorkspace = async () => {
    await Promise.all([
      utils.workspace.all.invalidate(),
      utils.workspace.byId.invalidate({ workspacePublicId }),
    ]);
  };

  const uploadLogo = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    try {
      const response = await fetch(
        `/api/upload/workspace-logo?workspacePublicId=${encodeURIComponent(workspacePublicId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": selectedFile.type,
            "x-original-filename": encodeURIComponent(selectedFile.name),
          },
          body: selectedFile,
        },
      );

      if (!response.ok) {
        throw new Error("Unable to upload workspace image");
      }

      setSelectedFile(null);
      await refreshWorkspace();
      showPopup({
        header: t`Workspace image updated`,
        message: t`The workspace image is now visible to its members.`,
        icon: "success",
      });
    } catch {
      showPopup({
        header: t`Unable to update workspace image`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeLogo = async () => {
    setIsRemoving(true);
    try {
      const response = await fetch(
        `/api/upload/workspace-logo?workspacePublicId=${encodeURIComponent(workspacePublicId)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        throw new Error("Unable to remove workspace image");
      }

      await refreshWorkspace();
      showPopup({
        header: t`Workspace image removed`,
        message: t`The workspace will use its initial instead.`,
        icon: "success",
      });
    } catch {
      showPopup({
        header: t`Unable to remove workspace image`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div>
      <WorkspaceLogoPicker
        workspaceName={workspaceName}
        currentLogo={workspaceLogo}
        selectedFile={selectedFile}
        onFileSelect={setSelectedFile}
        onRemove={removeLogo}
        disabled={disabled || isUploading}
        isRemoving={isRemoving}
      />
      {selectedFile && !disabled && (
        <div className="mt-4">
          <Button
            type="button"
            size="sm"
            onClick={uploadLogo}
            isLoading={isUploading}
            disabled={isUploading}
          >
            {t`Save image`}
          </Button>
        </div>
      )}
    </div>
  );
}
