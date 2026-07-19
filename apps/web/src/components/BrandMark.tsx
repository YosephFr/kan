import Image from "next/image";
import { twMerge } from "tailwind-merge";

import { api } from "~/utils/api";

export function BrandMark({
  variant = "sidebar",
  className,
}: {
  variant?: "sidebar" | "login";
  className?: string;
}) {
  const { data } = api.branding.get.useQuery();
  const brandName = data?.brandName ?? "kan.bn";

  if (!data?.brandLogo) {
    return (
      <span
        className={twMerge(
          "font-bold tracking-tight text-neutral-900 dark:text-dark-1000",
          variant === "login" ? "text-lg" : "text-[16px]",
          className,
        )}
      >
        {brandName}
      </span>
    );
  }

  return (
    <span
      className={twMerge(
        "relative flex items-center overflow-hidden rounded bg-white dark:bg-dark-300",
        variant === "login" ? "h-10 w-44" : "h-8 w-36",
        className,
      )}
    >
      <Image
        src={data.brandLogo}
        alt={brandName}
        fill
        sizes={variant === "login" ? "176px" : "144px"}
        className="object-contain"
      />
    </span>
  );
}
