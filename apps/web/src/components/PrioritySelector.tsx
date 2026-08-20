import { Menu, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment } from "react";
import {
  HiChevronUpDown,
  HiExclamationTriangle,
  HiFlag,
  HiOutlineFlag,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardPriority } from "~/utils/card-presentation";
import { cardPriorityValues } from "~/utils/card-presentation";

interface PrioritySelectorProps {
  value: CardPriority;
  onChange: (priority: CardPriority) => void;
  disabled?: boolean;
  compact?: boolean;
}

export const getPriorityPresentation = (priority: CardPriority) => {
  switch (priority) {
    case "urgent":
      return {
        label: t`Urgent`,
        icon: HiExclamationTriangle,
        className: "text-red-600 dark:text-red-400",
      };
    case "high":
      return {
        label: t`High`,
        icon: HiFlag,
        className: "text-orange-600 dark:text-orange-400",
      };
    case "medium":
      return {
        label: t`Medium`,
        icon: HiFlag,
        className: "text-yellow-700 dark:text-yellow-400",
      };
    case "low":
      return {
        label: t`Low`,
        icon: HiOutlineFlag,
        className: "text-sky-600 dark:text-sky-400",
      };
    default:
      return {
        label: t`No priority`,
        icon: HiOutlineFlag,
        className: "text-light-700 dark:text-dark-700",
      };
  }
};

export function PriorityIndicator({ priority }: { priority: CardPriority }) {
  const presentation = getPriorityPresentation(priority);
  const Icon = presentation.icon;

  return (
    <span
      className={twMerge(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        presentation.className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {presentation.label}
    </span>
  );
}

export default function PrioritySelector({
  value,
  onChange,
  disabled = false,
  compact = false,
}: PrioritySelectorProps) {
  return (
    <Menu as="div" className="relative w-full text-left">
      <Menu.Button
        disabled={disabled}
        className={twMerge(
          "flex w-full items-center justify-between rounded-md border border-light-400 bg-light-50 px-2.5 py-2 text-xs hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-500 dark:bg-dark-200 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-1000",
          compact && "border-light-50 bg-transparent py-1 dark:border-dark-50",
        )}
      >
        <PriorityIndicator priority={value} />
        <HiChevronUpDown className="h-4 w-4 text-light-700 dark:text-dark-700" />
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-[120] mt-2 w-48 rounded-md border border-light-300 bg-light-50 p-1 shadow-lg focus:outline-none dark:border-dark-400 dark:bg-dark-200">
          {cardPriorityValues.map((priority) => (
            <Menu.Item key={priority}>
              <button
                type="button"
                onClick={() => onChange(priority)}
                aria-pressed={value === priority}
                className={twMerge(
                  "flex w-full items-center rounded-md px-2.5 py-2 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-1000",
                  value === priority && "bg-light-100 dark:bg-dark-300",
                )}
              >
                <PriorityIndicator priority={priority} />
              </button>
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
