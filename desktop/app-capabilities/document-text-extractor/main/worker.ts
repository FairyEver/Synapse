import { parentPort, workerData } from "node:worker_threads"
import { extractText, getDocumentProxy } from "unpdf"
import type {
  DocumentTextExtractionWorkerInput,
  DocumentTextExtractionWorkerMessage,
} from "./worker-protocol.js"

function post(message: DocumentTextExtractionWorkerMessage): void {
  parentPort?.postMessage(message)
}

function normalizeDocumentText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replaceAll("\0", "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function isPasswordError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === "PasswordException" || /password/i.test(error.message)
}

async function extractPdf(
  input: DocumentTextExtractionWorkerInput,
): Promise<DocumentTextExtractionWorkerMessage> {
  let document
  try {
    document = await getDocumentProxy(new Uint8Array(input.bytes))
  } catch (error) {
    return {
      type: "error",
      code: isPasswordError(error) ? "PASSWORD_PROTECTED" : "INVALID_DOCUMENT",
    }
  }

  try {
    if (document.numPages > input.maxPages) {
      return { type: "error", code: "PDF_PAGE_LIMIT_EXCEEDED" }
    }

    let pages: string[]
    try {
      const extracted = await extractText(document, { mergePages: false })
      pages = extracted.text
    } catch (error) {
      return {
        type: "error",
        code: isPasswordError(error) ? "PASSWORD_PROTECTED" : "EXTRACTION_FAILED",
      }
    }

    const text = normalizeDocumentText(pages.join("\n\n"))
    if (Buffer.byteLength(text, "utf8") > input.maxTextBytes) {
      return { type: "error", code: "TEXT_TOO_LARGE" }
    }
    return {
      type: "success",
      result: { text, pages: document.numPages },
    }
  } finally {
    await document.destroy()
  }
}

void extractPdf(workerData as DocumentTextExtractionWorkerInput)
  .then(post)
  .catch(() => post({ type: "error", code: "EXTRACTION_FAILED" }))
