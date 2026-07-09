import type { TextItem } from "pdfjs-dist/types/src/display/api";

let workerConfigured = false;

async function ensureWorker() {
  if (workerConfigured) return;
  const lib = await import("pdfjs-dist");
  // Resolve the worker URL via Vite's asset handling
  const { default: workerSrc } = await import(
    "pdfjs-dist/build/pdf.worker.min.mjs?url"
  );
  lib.GlobalWorkerOptions.workerSrc = workerSrc;
  workerConfigured = true;
}

export async function extractPdfText(file: File): Promise<string> {
  await ensureWorker();
  const { getDocument } = await import("pdfjs-dist");
  const data = await file.arrayBuffer();
  const pdf = await getDocument({ data }).promise;
  const chunks: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item): item is TextItem => "str" in item)
      .map((item) => item.str)
      .join(" ");
    chunks.push(text);
  }
  return chunks.join("\n\n").replace(/\s{2,}/g, " ").trim();
}
