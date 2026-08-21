import type { PDFDocumentProxy } from "pdfjs-dist";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import {
  HiChevronLeft,
  HiChevronRight,
  HiOutlineDocumentText,
} from "react-icons/hi2";

const importPdfJs = () => import("pdfjs-dist");

let pdfJsPromise: ReturnType<typeof importPdfJs> | null = null;

async function loadPdfJs() {
  pdfJsPromise ??= importPdfJs().then((module) => {
    module.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
    return module;
  });
  return pdfJsPromise;
}

async function renderPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  maxWidth: number,
  maxHeight: number,
  signal: AbortSignal,
) {
  const page = await document.getPage(pageNumber);
  const initialViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    maxWidth / initialViewport.width,
    maxHeight / initialViewport.height,
  );
  const viewport = page.getViewport({ scale });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const context = canvas.getContext("2d");
  if (!context) return;

  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform:
      pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  });
  const cancel = () => renderTask.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await renderTask.promise;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export function CardPdfThumbnail({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setIsVisible(true);
      },
      { rootMargin: "160px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isVisible || !canvas) return;
    let document: PDFDocumentProxy | null = null;
    let cancelled = false;
    const controller = new AbortController();

    void loadPdfJs()
      .then(
        (pdfjs) => pdfjs.getDocument({ url, withCredentials: true }).promise,
      )
      .then(async (loadedDocument) => {
        if (cancelled) {
          await loadedDocument.destroy();
          return;
        }
        document = loadedDocument;
        await renderPage(
          loadedDocument,
          1,
          canvas,
          260,
          156,
          controller.signal,
        );
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setFailed(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
      void document?.destroy();
    };
  }, [isVisible, url]);

  return (
    <div
      ref={hostRef}
      className="flex h-40 items-center justify-center overflow-hidden bg-light-100 dark:bg-dark-100"
    >
      {failed ? (
        <HiOutlineDocumentText className="h-8 w-8 text-light-600 dark:text-dark-600" />
      ) : (
        <canvas ref={canvasRef} className="max-h-full max-w-full shadow-sm" />
      )}
    </div>
  );
}

export function CardPdfViewer({ url, title }: { url: string; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setFailed(false);
    setPageNumber(1);
    void loadPdfJs()
      .then(
        (pdfjs) => pdfjs.getDocument({ url, withCredentials: true }).promise,
      )
      .then((document) => {
        if (cancelled) {
          void document.destroy();
          return;
        }
        documentRef.current = document;
        setPageCount(document.numPages);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      void documentRef.current?.destroy();
      documentRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas || pageCount === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    void renderPage(document, pageNumber, canvas, 1100, 760, controller.signal)
      .then(() => {
        if (!cancelled) setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setFailed(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pageCount, pageNumber]);

  if (failed) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center p-8 text-center">
        <div>
          <HiOutlineDocumentText className="mx-auto h-9 w-9 text-light-600 dark:text-dark-600" />
          <p className="mt-3 text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`This PDF could not be previewed`}
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-xs font-medium text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
          >
            {t`Open PDF`}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 items-start justify-center overflow-auto bg-light-200 p-4 dark:bg-dark-50 sm:p-6">
        {isLoading && (
          <div className="absolute inset-x-6 top-6 h-[70%] animate-pulse rounded-md bg-light-300 dark:bg-dark-300" />
        )}
        <canvas
          ref={canvasRef}
          aria-label={t`${title}, page ${pageNumber}`}
          className="relative max-w-full bg-white shadow-sm"
        />
      </div>
      {pageCount > 0 && (
        <div className="flex items-center justify-center gap-4 border-t border-light-300 px-4 py-3 dark:border-dark-400">
          <button
            type="button"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
            className="flex h-8 w-8 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:opacity-40 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            aria-label={t`Previous page`}
          >
            <HiChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-24 text-center text-xs tabular-nums text-light-800 dark:text-dark-800">
            {t`Page ${pageNumber} of ${pageCount}`}
          </span>
          <button
            type="button"
            disabled={pageNumber >= pageCount}
            onClick={() =>
              setPageNumber((page) => Math.min(pageCount, page + 1))
            }
            className="flex h-8 w-8 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:opacity-40 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            aria-label={t`Next page`}
          >
            <HiChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
