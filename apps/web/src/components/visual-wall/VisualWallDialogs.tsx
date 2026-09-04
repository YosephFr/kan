import Image from "next/image";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { HiOutlineXMark } from "react-icons/hi2";

import type { VisualWallItem } from "./visual-wall-types";
import Button from "../Button";
import Input from "../Input";
import { isFreeformShareUrl } from "./visual-wall-layout";

export function VisualWallPreviewDialog({
  item,
  onClose,
}: {
  item: VisualWallItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(item)} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-8">
        <DialogPanel className="relative flex max-h-full w-full max-w-6xl flex-col bg-light-50 p-3 shadow-2xl dark:bg-dark-100 sm:p-5">
          <div className="mb-3 flex min-h-11 items-center justify-between gap-4">
            <DialogTitle className="truncate text-sm font-semibold text-light-1000 dark:text-dark-1000">
              {item?.title}
            </DialogTitle>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-light-900 hover:bg-light-300 dark:text-dark-900 dark:hover:bg-dark-300"
              onClick={onClose}
              aria-label={t`Close preview`}
            >
              <HiOutlineXMark className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {item && (
            <Image
              src={item.viewUrl}
              alt={item.title}
              width={Math.max(1, Math.round(item.width))}
              height={Math.max(1, Math.round(item.height))}
              unoptimized
              className="max-h-[calc(100dvh-8rem)] min-h-0 w-full object-contain"
            />
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function VisualWallFreeformDialog({
  open,
  currentUrl,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  currentUrl: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (url: string | null) => void | Promise<void>;
}) {
  const [value, setValue] = useState(currentUrl ?? "");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setValue(currentUrl ?? "");
    setError(undefined);
  }, [currentUrl, open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = value.trim();
    if (normalized && !isFreeformShareUrl(normalized)) {
      setError(t`Paste a valid iCloud Freeform share link.`);
      return;
    }
    try {
      await onSave(normalized || null);
      onClose();
    } catch {
      setError(t`The Freeform link could not be saved. Try again.`);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      className="relative z-50"
    >
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-lg rounded-lg border border-light-500 bg-light-50 p-5 shadow-2xl dark:border-dark-500 dark:bg-dark-100">
          <DialogTitle className="text-base font-semibold text-light-1000 dark:text-dark-1000">
            {currentUrl ? t`Change Freeform link` : t`Add Freeform link`}
          </DialogTitle>
          <p className="mt-1 text-sm leading-6 text-light-700 dark:text-dark-700">
            {t`Kan shows the visual references here. Open Freeform when you need to draw or edit the shared board.`}
          </p>
          <form className="mt-5" onSubmit={submit}>
            <Input
              autoFocus
              inputMode="url"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://www.icloud.com/freeform/..."
              errorMessage={error}
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={onClose}
                disabled={busy}
              >
                {t`Cancel`}
              </Button>
              {currentUrl && (
                <Button
                  type="button"
                  variant="danger"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => {
                    void Promise.resolve(onSave(null))
                      .then(onClose)
                      .catch(() =>
                        setError(t`The Freeform link could not be removed.`),
                      );
                  }}
                >
                  {t`Remove link`}
                </Button>
              )}
              <Button type="submit" isLoading={busy} className="min-h-11">
                {t`Save`}
              </Button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
