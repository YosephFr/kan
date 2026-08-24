import Image from "next/image";
import { t } from "@lingui/core/macro";
import { HiArrowTopRightOnSquare, HiLink } from "react-icons/hi2";

import type { WebCardResource } from "./card-resource-types";

export const getWebResourceDomain = (openUrl: string) => {
  try {
    return new URL(openUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
};

export const getWebResourcePreviewImage = (resource: WebCardResource) => {
  const expectedPath = `/api/resources/${resource.publicId}/preview-image`;
  return resource.previewImageUrl === expectedPath ? expectedPath : null;
};

export function CardCanvasWebResourceCard({
  resource,
  onOpenResource,
}: {
  resource: WebCardResource;
  onOpenResource: () => void;
}) {
  const domain = getWebResourceDomain(resource.openUrl);
  const previewImageUrl = getWebResourcePreviewImage(resource);

  return (
    <article
      tabIndex={0}
      onDoubleClick={onOpenResource}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") {
          onOpenResource();
        }
      }}
      className="flex h-full w-full flex-col overflow-hidden rounded-md border border-light-400 bg-light-50 text-left text-light-1000 dark:border-dark-500 dark:bg-dark-100 dark:text-dark-1000"
      aria-label={t`Web link: ${resource.title}`}
    >
      {previewImageUrl && (
        <div className="relative h-14 shrink-0 bg-light-200 dark:bg-dark-200">
          <Image
            src={previewImageUrl}
            alt=""
            fill
            sizes="300px"
            unoptimized
            referrerPolicy="no-referrer"
            className="object-cover"
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1 text-[9px] font-medium text-light-600 dark:text-dark-600">
          <HiLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{resource.siteName ?? domain}</span>
          {resource.siteName && domain && (
            <span className="truncate font-normal">· {domain}</span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-4">
          {resource.title}
        </p>
        {resource.description && (
          <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-light-700 dark:text-dark-700">
            {resource.description}
          </p>
        )}
        <a
          href={resource.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          className="mt-auto inline-flex min-h-7 w-fit items-center gap-1 rounded px-1.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
        >
          {t`Open link`}
          <HiArrowTopRightOnSquare className="h-3 w-3" />
        </a>
      </div>
    </article>
  );
}
