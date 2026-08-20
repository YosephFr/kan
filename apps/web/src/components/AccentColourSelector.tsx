import { Menu, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment } from "react";
import { HiChevronUpDown, HiXMark } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { colours } from "@kan/shared/constants";

interface AccentColourSelectorProps {
  value?: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
}

export const getColourName = (name: string) => {
  switch (name) {
    case "Teal":
      return t`Teal`;
    case "Green":
      return t`Green`;
    case "Blue":
      return t`Blue`;
    case "Purple":
      return t`Purple`;
    case "Yellow":
      return t`Yellow`;
    case "Orange":
      return t`Orange`;
    case "Red":
      return t`Red`;
    case "Pink":
      return t`Pink`;
    default:
      return name;
  }
};

export default function AccentColourSelector({
  value,
  onChange,
  disabled = false,
  compact = false,
}: AccentColourSelectorProps) {
  const selected = colours.find((colour) => colour.code === value);

  return (
    <Menu as="div" className="relative w-full text-left">
      <Menu.Button
        disabled={disabled}
        className={twMerge(
          "flex w-full items-center justify-between rounded-md border border-light-400 bg-light-50 px-2.5 py-2 text-xs text-light-950 hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-950 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-1000",
          compact && "border-light-50 bg-transparent py-1 dark:border-dark-50",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.code }}
              aria-hidden="true"
            />
          ) : (
            <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full border border-light-600 dark:border-dark-600">
              <HiXMark className="h-2 w-2" aria-hidden="true" />
            </span>
          )}
          <span className="truncate">
            {selected ? getColourName(selected.name) : t`No colour`}
          </span>
        </span>
        <HiChevronUpDown className="h-4 w-4 shrink-0 text-light-700 dark:text-dark-700" />
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
        <Menu.Items className="absolute right-0 z-[120] mt-2 w-56 rounded-md border border-light-300 bg-light-50 p-2 shadow-lg focus:outline-none dark:border-dark-400 dark:bg-dark-200">
          <p className="px-1 pb-2 text-xs font-medium text-light-800 dark:text-dark-800">
            {t`Accent colour`}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {colours.map((colour) => (
              <Menu.Item key={colour.code}>
                <button
                  type="button"
                  onClick={() => onChange(colour.code)}
                  aria-label={getColourName(colour.name)}
                  aria-pressed={value === colour.code}
                  className={twMerge(
                    "flex h-9 items-center justify-center rounded-md border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 dark:focus-visible:ring-dark-1000",
                    value === colour.code &&
                      "border-light-1000 dark:border-dark-1000",
                  )}
                >
                  <span
                    className="h-5 w-5 rounded-full"
                    style={{ backgroundColor: colour.code }}
                    aria-hidden="true"
                  />
                </button>
              </Menu.Item>
            ))}
          </div>
          <Menu.Item>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 dark:text-dark-900 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-1000"
            >
              <HiXMark className="h-4 w-4" aria-hidden="true" />
              {t`Remove colour`}
            </button>
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
