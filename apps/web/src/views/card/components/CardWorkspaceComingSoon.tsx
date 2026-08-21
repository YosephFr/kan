import type { IconType } from "react-icons";
import { t } from "@lingui/core/macro";
import { HiOutlinePaperClip, HiOutlinePencilSquare } from "react-icons/hi2";

import type { CardWorkspaceView } from "~/utils/card-workspace";

export function CardWorkspaceComingSoon({
  view,
}: {
  view: Extract<CardWorkspaceView, "whiteboard" | "files">;
}) {
  const presentation: {
    icon: IconType;
    title: string;
    description: string;
  } =
    view === "whiteboard"
      ? {
          icon: HiOutlinePencilSquare,
          title: t`Whiteboard is the next phase`,
          description: t`This view will become the visual space for frames, sketches, images and connected ideas. Nothing is being saved here yet.`,
        }
      : {
          icon: HiOutlinePaperClip,
          title: t`File centre is the next phase`,
          description: t`This view will bring together uploads, previews and Drive links. Current card attachments remain available in Summary.`,
        };
  const Icon = presentation.icon;

  return (
    <section
      id={`card-view-${view}`}
      role="tabpanel"
      aria-labelledby={`card-tab-${view}`}
      className="flex h-full min-h-[28rem] items-center justify-center px-6 py-12"
    >
      <div className="max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-light-300 text-light-800 dark:border-dark-400 dark:text-dark-800">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-light-1000 dark:text-dark-1000">
          {presentation.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-light-800 dark:text-dark-800">
          {presentation.description}
        </p>
      </div>
    </section>
  );
}
