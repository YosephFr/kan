import dynamic from "next/dynamic";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import { useDashboardSurface } from "~/components/DashboardSurfaceContext";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

const WorkspaceGoalsCanvas = dynamic(
  () =>
    import("./WorkspaceGoalsCanvas").then(
      (module) => module.WorkspaceGoalsCanvas,
    ),
  { ssr: false },
);

interface WorkspaceGoalsSectionProps {
  workspacePublicId: string;
  workspaceName: string;
  canEdit: boolean;
}

export function WorkspaceGoalsSection({
  workspacePublicId,
  workspaceName,
  canEdit,
}: WorkspaceGoalsSectionProps) {
  const { mode, scrollContainerRef } = useDashboardSurface();
  const extended = mode === "workspace-whiteboard";
  const sectionRef = useRef<HTMLElement | null>(null);
  const [mountedWorkspacePublicId, setMountedWorkspacePublicId] = useState<
    string | null
  >(null);
  const [assetsReady, setAssetsReady] = useState(false);
  const shouldMount = mountedWorkspacePublicId === workspacePublicId;

  useEffect(() => {
    if (shouldMount) return;
    if (typeof IntersectionObserver === "undefined") {
      setMountedWorkspacePublicId(workspacePublicId);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setMountedWorkspacePublicId(workspacePublicId);
        observer.disconnect();
      },
      {
        root: scrollContainerRef.current,
        rootMargin: "600px 0px",
      },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, [scrollContainerRef, shouldMount, workspacePublicId]);

  useEffect(() => {
    if (!shouldMount) return;
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
  }, [shouldMount]);

  return (
    <section
      ref={sectionRef}
      className="mt-14 w-full min-w-0 border-t border-light-300 pb-12 pt-9 dark:border-dark-300"
      aria-labelledby="workspace-goals-heading"
    >
      <div
        aria-hidden={extended || undefined}
        inert={(extended ? "true" : undefined) as unknown as boolean}
        className={extended ? "hidden" : "mb-5"}
      >
        <h2
          id="workspace-goals-heading"
          className="text-base font-bold tracking-tight text-light-1000 dark:text-dark-1000"
        >
          {t`Vision and goals for ${workspaceName}`}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-light-700 dark:text-dark-700">
          {t`Draw, paste text and organise the goals this company is working towards.`}
        </p>
      </div>
      {!shouldMount || !assetsReady ? (
        <div
          className="flex h-[70dvh] min-h-[28rem] items-center justify-center bg-light-100 dark:bg-dark-50"
          role="status"
        >
          <div className="flex items-center gap-2 text-sm text-light-700 dark:text-dark-700">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-light-400 border-t-light-900 dark:border-dark-400 dark:border-t-dark-900" />
            {t`Loading whiteboard…`}
          </div>
        </div>
      ) : (
        <WorkspaceGoalsCanvas
          key={workspacePublicId}
          workspacePublicId={workspacePublicId}
          workspaceName={workspaceName}
          canEdit={canEdit}
        />
      )}
    </section>
  );
}
