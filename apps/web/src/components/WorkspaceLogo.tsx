import Image from "next/image";
import { twMerge } from "tailwind-merge";

const sizeClasses = {
  sm: "h-6 w-6 rounded-md text-xs",
  md: "h-8 w-8 rounded-md text-sm",
  lg: "h-16 w-16 rounded-lg text-xl",
} as const;

const pixelSizes = {
  sm: 24,
  md: 32,
  lg: 64,
} as const;

export function WorkspaceLogo({
  name,
  logo,
  size = "sm",
  className,
}: {
  name: string;
  logo?: string | null;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  const pixels = pixelSizes[size];

  return (
    <span
      className={twMerge(
        "relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden bg-indigo-700 font-semibold leading-none text-white",
        sizeClasses[size],
        className,
      )}
    >
      {logo ? (
        <Image
          src={logo}
          alt={name}
          width={pixels}
          height={pixels}
          className="h-full w-full object-cover"
        />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
