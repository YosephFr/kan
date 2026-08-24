import { Dialog, Transition } from "@headlessui/react";
import { Fragment } from "react";

import { useModal } from "~/providers/modal";

interface Props {
  children: React.ReactNode;
  modalSize?: "sm" | "md" | "lg" | "full";
  positionFromTop?: "sm" | "md" | "lg";
  isVisible?: boolean;
  closeOnClickOutside?: boolean;
  centered?: boolean;
  onClose?: () => void;
}

const Modal: React.FC<Props> = ({
  children,
  modalSize = "sm",
  positionFromTop = "md",
  isVisible,
  closeOnClickOutside,
  centered = false,
  onClose,
}) => {
  const {
    isOpen,
    closeModal,
    closeOnClickOutside: modalCloseOnClickOutside,
  } = useModal();

  const shouldShow = isVisible ?? isOpen;
  const shouldCloseOnClickOutside =
    closeOnClickOutside ?? modalCloseOnClickOutside;
  const handleClose = onClose ?? closeModal;

  const modalSizeMap = {
    sm: "max-w-[400px]",
    md: "max-w-[550px]",
    lg: "max-w-[800px]",
    full: "h-[100dvh] max-w-none rounded-none border-0",
  };

  const positionFromTopMap = {
    sm: "mt-[12vh]",
    md: "mt-[25vh]",
    lg: "mt-[50vh]",
  };

  return (
    <Transition.Root show={shouldShow} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={shouldCloseOnClickOutside ? handleClose : () => null}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-light-50 bg-opacity-40 transition-opacity dark:bg-dark-50 dark:bg-opacity-40" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 w-screen overflow-y-auto">
          <div
            className={`flex min-h-full justify-center text-center ${modalSize === "full" ? "p-0" : "p-4 sm:p-0"} ${centered ? "items-center" : "items-start sm:items-start"}`}
          >
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel
                className={`relative ${centered || modalSize === "full" ? "" : positionFromTopMap[positionFromTop]} w-full transform border border-light-600 bg-white/90 text-left shadow-3xl-light backdrop-blur-[6px] transition-all dark:border-dark-600 dark:bg-dark-100/90 dark:shadow-3xl-dark ${modalSize === "full" ? "rounded-none" : "rounded-lg"} ${modalSizeMap[modalSize]}`}
              >
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
};

export default Modal;
