import dynamic from "next/dynamic";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

import type { WorkspaceMemberOption } from "./subtask-types";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

const CardWhiteboardCanvas = dynamic(
  () =>
    import("./CardWhiteboardCanvas").then(
      (module) => module.CardWhiteboardCanvas,
    ),
  { ssr: false },
);

interface CardWhiteboardViewProps {
  cardPublicId: string;
  cardTitle: string;
  members: WorkspaceMemberOption[];
  canEdit: boolean;
  isPublicBoard: boolean;
  compact?: boolean;
  embedded?: boolean;
  isVisible?: boolean;
  onCanvasCreated?: () => void;
  onClose?: () => void;
}

export function CardWhiteboardView({
  embedded = false,
  isVisible = true,
  ...props
}: CardWhiteboardViewProps) {
  const [assetsReady, setAssetsReady] = useState(false);

  useEffect(() => {
    window.EXCALIDRAW_ASSET_PATH = "/vendor/excalidraw/";
    const selector = 'link[data-kan-excalidraw="true"]';
    const existing = document.head.querySelector<HTMLLinkElement>(selector);
    if (existing) {
      setAssetsReady(true);
      return;
    }
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/vendor/excalidraw/index.css";
    stylesheet.dataset.kanExcalidraw = "true";
    stylesheet.addEventListener("load", () => setAssetsReady(true), {
      once: true,
    });
    stylesheet.addEventListener("error", () => setAssetsReady(true), {
      once: true,
    });
    document.head.appendChild(stylesheet);
  }, []);

  if (!assetsReady) {
    return (
      <div
        className={twMerge(
          "flex min-h-[24rem] items-center justify-center bg-light-100 dark:bg-dark-50",
          embedded ? "h-[68dvh] max-h-[52rem] w-full" : "h-full",
          !isVisible && "hidden",
        )}
        role="status"
      >
        <div className="flex items-center gap-2 text-sm text-light-700 dark:text-dark-700">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-light-400 border-t-light-900 dark:border-dark-400 dark:border-t-dark-900" />
          {t`Loading whiteboard…`}
        </div>
      </div>
    );
  }

  return (
    <CardWhiteboardCanvas
      {...props}
      embedded={embedded}
      isVisible={isVisible}
    />
  );
}
