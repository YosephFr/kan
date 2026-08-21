import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { t } from "@lingui/core/macro";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { HiXMark } from "react-icons/hi2";
import { z } from "zod";

import Button from "~/components/Button";
import { DuplicateResourcesNotice } from "~/components/DuplicateResourcesNotice";
import Input from "~/components/Input";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { getBoardUploadCount } from "~/utils/resource-summary";

const schema = z.object({
  name: z
    .string()
    .min(1, { message: t`Template name is required` })
    .max(100, { message: t`Template name cannot exceed 100 characters` }),
  workspacePublicId: z.string(),
  sourceBoardPublicId: z.string(),
});

interface NewBoardInputWithTemplate {
  name: string;
  workspacePublicId: string;
  sourceBoardPublicId: string;
}

export function NewTemplateForm({
  sourceBoardPublicId,
  workspacePublicId,
  sourceBoardName,
}: {
  sourceBoardPublicId: string;
  workspacePublicId: string;
  sourceBoardName: string;
}) {
  const router = useRouter();
  const { closeModal } = useModal();
  const { showPopup } = usePopup();
  const sourceBoardQuery = api.board.byId.useQuery(
    { boardPublicId: sourceBoardPublicId, type: "regular" },
    { enabled: sourceBoardPublicId.length >= 12 },
  );
  const sourceUploadCount = getBoardUploadCount(
    sourceBoardQuery.data?.lists ?? [],
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewBoardInputWithTemplate>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: sourceBoardName,
      workspacePublicId,
      sourceBoardPublicId,
    },
  });

  const createBoard = api.board.create.useMutation({
    onSuccess: (newTemplate) => {
      router.push(`/templates/${newTemplate.publicId}`);
      showPopup({
        header: t`Template created`,
        message: t`Template created successfully`,
        icon: "success",
      });
      closeModal();
    },
    onError: () => {
      showPopup({
        header: t`Unable to create template`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
  });

  const onSubmit = (data: NewBoardInputWithTemplate) => {
    if (!sourceBoardQuery.data || sourceBoardQuery.isError) return;
    createBoard.mutate({
      name: data.name,
      workspacePublicId: data.workspacePublicId,
      sourceBoardPublicId: data.sourceBoardPublicId,
      lists: [],
      labels: [],
      type: "template",
    });
  };

  useEffect(() => {
    const titleElement: HTMLElement | null =
      document.querySelector<HTMLElement>("#name");
    if (titleElement) titleElement.focus();
  }, []);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="px-5 pt-5">
        <div className="text-neutral-9000 flex w-full items-center justify-between pb-4 dark:text-dark-1000">
          <h2 className="text-sm font-bold">{t`New template`}</h2>
          <button
            type="button"
            className="rounded p-1 hover:bg-light-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-800"
            aria-label={t`Close`}
            onClick={(e) => {
              e.preventDefault();
              closeModal();
            }}
          >
            <HiXMark size={18} className="dark:text-dark-9000 text-light-900" />
          </button>
        </div>
        <Input
          id="name"
          placeholder={t`Name`}
          {...register("name", { required: true })}
          errorMessage={errors.name?.message}
          onKeyDown={async (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              await handleSubmit(onSubmit)();
            }
          }}
        />
      </div>
      {sourceUploadCount > 0 && (
        <div className="px-5 pt-4">
          <DuplicateResourcesNotice uploadCount={sourceUploadCount} />
        </div>
      )}
      {sourceBoardQuery.isError && (
        <p
          role="alert"
          className="px-5 pt-4 text-xs text-red-600 dark:text-red-400"
        >
          {t`Uploaded files could not be checked. Reopen this form and try again.`}
        </p>
      )}
      <div className="mt-12 flex items-center justify-end border-t border-light-600 px-5 pb-5 pt-5 dark:border-dark-600">
        <div>
          <Button
            type="submit"
            isLoading={createBoard.isPending || sourceBoardQuery.isLoading}
            disabled={sourceBoardQuery.isError}
          >
            {t`Create template`}
          </Button>
        </div>
      </div>
    </form>
  );
}
