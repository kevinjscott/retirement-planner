/** Client-only: render PDF pages to JPEG data URLs for vision extraction. */

const MAX_PAGES = 8;
const SCALE = 1.5;

export type PdfPageImage = {
  dataUrl: string;
  mediaType: "image/jpeg";
  page: number;
};

export async function pdfFileToImages(file: File): Promise<PdfPageImage[]> {
  const pdfjs = await import("pdfjs-dist");
  // Worker must resolve in the browser bundle.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  const images: PdfPageImage[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    images.push({
      dataUrl: canvas.toDataURL("image/jpeg", 0.82),
      mediaType: "image/jpeg",
      page: pageNum,
    });
  }

  return images;
}

export function dataUrlToBase64(dataUrl: string): {
  base64: string;
  mediaType: string;
} {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Expected a base64 data URL");
  }
  return { mediaType: match[1], base64: match[2] };
}
