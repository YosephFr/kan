import Image from "next/image";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop from "react-image-crop";

import "react-image-crop/dist/ReactCrop.css";

import Button from "~/components/Button";
import Modal from "~/components/modal";
import { usePopup } from "~/providers/popup";

interface PercentCrop {
  unit: "%";
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropProps {
  crop: PercentCrop | undefined;
  onChange: (crop: PixelCrop, percentCrop: PercentCrop) => void;
  aspect: number;
  className?: string;
  children: React.ReactNode;
}

const SquareCrop = ReactCrop as unknown as React.FC<CropProps>;

export function SquareImageCropModal({
  file,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  file: File;
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [crop, setCrop] = useState<PercentCrop>();
  const [isProcessing, setIsProcessing] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const { showPopup } = usePopup();

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setCrop(undefined);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      const width =
        naturalWidth >= naturalHeight
          ? (naturalHeight / naturalWidth) * 90
          : 90;
      const height =
        naturalHeight >= naturalWidth
          ? (naturalWidth / naturalHeight) * 90
          : 90;
      setCrop({
        unit: "%",
        x: (100 - width) / 2,
        y: (100 - height) / 2,
        width,
        height,
      });
    },
    [],
  );

  const handleConfirm = async () => {
    if (!imageRef.current || !crop) return;

    setIsProcessing(true);
    try {
      const image = imageRef.current;
      const cropX = (crop.x / 100) * image.naturalWidth;
      const cropY = (crop.y / 100) * image.naturalHeight;
      const cropWidth = (crop.width / 100) * image.naturalWidth;
      const cropHeight = (crop.height / 100) * image.naturalHeight;
      const outputSize = Math.max(
        1,
        Math.floor(Math.min(512, cropWidth, cropHeight)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        outputSize,
        outputSize,
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("Unable to crop image")),
          "image/png",
        );
      });
      const baseName = file.name.replace(/\.[^.]+$/, "") || "workspace-logo";
      onConfirm(
        new File([blob], `${baseName}.png`, {
          type: "image/png",
          lastModified: Date.now(),
        }),
      );
    } catch {
      showPopup({
        header: t`Unable to crop image`,
        message: t`Please try another image.`,
        icon: "error",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal modalSize="md" positionFromTop="sm" isVisible>
      <div className="p-4 sm:p-6">
        <h3 className="text-base font-semibold text-light-1000 dark:text-dark-1000">
          {title}
        </h3>
        <p className="mt-1 text-sm text-light-800 dark:text-dark-800">
          {description}
        </p>
        <div className="mt-4 max-h-[60vh] overflow-hidden rounded-md border border-light-600 bg-white p-2 dark:border-dark-600 dark:bg-dark-300">
          {previewUrl ? (
            <SquareCrop
              crop={crop}
              onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
              aspect={1}
              className="w-full"
            >
              <Image
                ref={imageRef}
                src={previewUrl}
                alt={t`Image to crop`}
                width={1024}
                height={1024}
                unoptimized
                onLoad={handleImageLoad}
                className="h-auto max-h-[50vh] w-full object-contain"
              />
            </SquareCrop>
          ) : (
            <div className="h-48 animate-pulse rounded bg-light-200 dark:bg-dark-400" />
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isProcessing}
          >
            {t`Cancel`}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            isLoading={isProcessing}
            disabled={!crop || isProcessing}
          >
            {t`Use image`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
