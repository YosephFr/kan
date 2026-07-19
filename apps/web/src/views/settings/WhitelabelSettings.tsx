import Image from "next/image";
import { useRouter } from "next/navigation";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import Button from "~/components/Button";
import Input from "~/components/Input";
import Modal from "~/components/modal";
import { NewWorkspaceForm } from "~/components/NewWorkspaceForm";
import { PageHead } from "~/components/PageHead";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

const acceptedLogoTypes = ["image/jpeg", "image/png", "image/webp"];

export default function WhitelabelSettings() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { modalContentType, isOpen } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const { data: branding, isLoading } = api.branding.get.useQuery();
  const updateBranding = api.branding.update.useMutation();
  const [brandName, setBrandName] = useState("");
  const [loginTitle, setLoginTitle] = useState("");
  const [loginDescription, setLoginDescription] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = useState(false);

  useEffect(() => {
    if (!branding) return;
    setBrandName(branding.brandName);
    setLoginTitle(branding.loginTitle ?? "");
    setLoginDescription(branding.loginDescription ?? "");
  }, [branding]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }

    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (!isLoading && branding && !branding.canManage) {
      router.replace("/settings/account");
    }
  }, [branding, isLoading, router]);

  const selectLogo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    if (!acceptedLogoTypes.includes(file.type)) {
      showPopup({
        header: t`Unable to use this image`,
        message: t`Choose a PNG, JPG, or WebP image.`,
        icon: "error",
      });
      return;
    }

    setLogoFile(file);
  };

  const uploadLogo = async () => {
    if (!logoFile) return;

    setIsUploadingLogo(true);
    try {
      const response = await fetch("/api/upload/brand-logo", {
        method: "POST",
        headers: {
          "Content-Type": logoFile.type,
          "x-original-filename": encodeURIComponent(logoFile.name),
        },
        body: logoFile,
      });
      if (!response.ok) throw new Error("Unable to upload brand logo");
      setLogoFile(null);
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!brandName.trim()) return;

    try {
      await updateBranding.mutateAsync({
        brandName: brandName.trim(),
        loginTitle: loginTitle.trim() || null,
        loginDescription: loginDescription.trim() || null,
      });
      await uploadLogo();
      await utils.branding.get.invalidate();
      showPopup({
        header: t`Branding updated`,
        message: t`The sidebar and sign-in page now use these settings.`,
        icon: "success",
      });
    } catch {
      showPopup({
        header: t`Unable to update branding`,
        message: t`Please try again.`,
        icon: "error",
      });
    }
  };

  const removeLogo = async () => {
    setIsRemovingLogo(true);
    try {
      const response = await fetch("/api/upload/brand-logo", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Unable to remove brand logo");
      setLogoFile(null);
      await utils.branding.get.invalidate();
      showPopup({
        header: t`Brand logo removed`,
        message: t`The brand name will be shown as text.`,
        icon: "success",
      });
    } catch {
      showPopup({
        header: t`Unable to remove brand logo`,
        message: t`Please try again.`,
        icon: "error",
      });
    } finally {
      setIsRemovingLogo(false);
    }
  };

  if (isLoading || !branding?.canManage) return null;

  const displayedLogo = logoPreview ?? branding.brandLogo;
  const isSaving = updateBranding.isPending || isUploadingLogo;

  return (
    <>
      <PageHead title={t`Settings | Whitelabel`} />
      <form
        onSubmit={save}
        className="mb-8 border-t border-light-300 dark:border-dark-300"
      >
        <section className="mt-8 max-w-2xl">
          <h2 className="text-[14px] font-bold text-neutral-900 dark:text-dark-1000">
            {t`Brand identity`}
          </h2>
          <p className="mt-1 text-sm text-light-900 dark:text-dark-900">
            {t`Used in the main navigation and on the sign-in page.`}
          </p>

          <label className="mt-6 block text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`Brand name`}
          </label>
          <Input
            value={brandName}
            onChange={(event) => setBrandName(event.target.value)}
            maxLength={64}
            className="mt-2 max-w-md"
            required
          />

          <label className="mt-6 block text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`Brand logo`}
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <div className="relative flex h-16 w-56 items-center justify-center overflow-hidden rounded-md border border-light-600 bg-white p-2 dark:border-dark-600 dark:bg-dark-300">
              {displayedLogo ? (
                <Image
                  src={displayedLogo}
                  alt={brandName || t`Brand logo`}
                  fill
                  sizes="224px"
                  className="object-contain p-2"
                  unoptimized={Boolean(logoPreview)}
                />
              ) : (
                <span className="font-bold tracking-tight text-light-1000 dark:text-dark-1000">
                  {brandName || "kan.bn"}
                </span>
              )}
            </div>
            <div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={selectLogo}
                disabled={isSaving}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => inputRef.current?.click()}
                  disabled={isSaving}
                >
                  {displayedLogo ? t`Change logo` : t`Upload logo`}
                </Button>
                {logoFile && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setLogoFile(null)}
                    disabled={isSaving}
                  >
                    {t`Discard`}
                  </Button>
                )}
                {!logoFile && branding.brandLogo && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={removeLogo}
                    isLoading={isRemovingLogo}
                    disabled={isSaving || isRemovingLogo}
                  >
                    {t`Remove`}
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-light-900 dark:text-dark-900">
                {t`PNG, JPG, or WebP. Wide transparent images work best.`}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-10 max-w-2xl border-t border-light-300 pt-8 dark:border-dark-300">
          <h2 className="text-[14px] font-bold text-neutral-900 dark:text-dark-1000">
            {t`Sign-in experience`}
          </h2>
          <p className="mt-1 text-sm text-light-900 dark:text-dark-900">
            {t`Leave either field blank to use the standard sign-in copy.`}
          </p>

          <label className="mt-6 block text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`Welcome title`}
          </label>
          <Input
            value={loginTitle}
            onChange={(event) => setLoginTitle(event.target.value)}
            maxLength={120}
            placeholder={t`Welcome back`}
            className="mt-2 max-w-md"
          />

          <label className="mt-6 block text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`Welcome message`}
          </label>
          <textarea
            value={loginDescription}
            onChange={(event) => setLoginDescription(event.target.value)}
            maxLength={280}
            rows={3}
            className="mt-2 block w-full max-w-xl resize-none rounded-md border-0 bg-white/5 px-3 py-2 text-sm text-light-1000 shadow-sm ring-1 ring-inset ring-light-600 placeholder:text-light-800 focus:ring-2 focus:ring-inset focus:ring-light-700 focus-visible:outline-none dark:text-dark-1000 dark:ring-dark-700 dark:placeholder:text-dark-800 dark:focus:ring-dark-700"
          />
        </section>

        <div className="mt-8">
          <Button
            type="submit"
            isLoading={isSaving}
            disabled={isSaving || !brandName.trim()}
          >
            {t`Save changes`}
          </Button>
        </div>
      </form>
      <Modal
        modalSize="sm"
        isVisible={isOpen && modalContentType === "NEW_WORKSPACE"}
      >
        <NewWorkspaceForm />
      </Modal>
    </>
  );
}
