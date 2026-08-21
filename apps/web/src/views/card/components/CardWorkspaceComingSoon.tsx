import { t } from "@lingui/core/macro";
import { HiOutlinePencilSquare } from "react-icons/hi2";

export function CardWorkspaceComingSoon() {
  return (
    <section
      id="card-view-whiteboard"
      role="tabpanel"
      aria-labelledby="card-tab-whiteboard"
      className="flex h-full min-h-[28rem] items-center justify-center px-6 py-12"
    >
      <div className="max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-light-300 text-light-800 dark:border-dark-400 dark:text-dark-800">
          <HiOutlinePencilSquare className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-light-1000 dark:text-dark-1000">
          {t`Whiteboard is the next phase`}
        </h2>
        <p className="mt-2 text-sm leading-6 text-light-800 dark:text-dark-800">
          {t`This view will become the visual space for frames, sketches, images and connected ideas. Nothing is being saved here yet.`}
        </p>
      </div>
    </section>
  );
}
