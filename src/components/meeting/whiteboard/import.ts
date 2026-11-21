/**
 * Turns pasted, dropped, or picked files into compressed images the
 * whiteboard can place and send to the other participants.
 */

export interface BoardImage {
  src: string;
  width: number;
  height: number;
}

const MAX_SIDE = 1600;
export const MAX_PDF_PAGES = 30;

function canvasToImage(source: CanvasImageSource, w: number, h: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return {
    src: canvas.toDataURL("image/jpeg", 0.8),
    width: canvas.width,
    height: canvas.height,
  };
}

export function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export async function fileToImage(file: File): Promise<BoardImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return canvasToImage(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function pdfToImages(file: File): Promise<BoardImage[]> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
  const images: BoardImage[] = [];
  try {
    const count = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: MAX_SIDE / Math.max(base.width, base.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({
        canvasContext: canvas.getContext("2d")!,
        viewport,
      }).promise;
      images.push(canvasToImage(canvas, canvas.width, canvas.height));
    }
  } finally {
    void doc.destroy();
  }
  return images;
}
