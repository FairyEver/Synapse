import type { LocalOcrEngine, LocalOcrRecognitionResult } from "./types"

export class UnavailableLocalOcrEngine implements LocalOcrEngine {
  async recognize(): Promise<LocalOcrRecognitionResult> {
    return {
      text: "",
      metadata: { available: false },
      warnings: [{
        code: "ocr_unavailable",
        message: "Local OCR is not configured.",
      }],
    }
  }
}

export function createUnavailableLocalOcrEngine(): LocalOcrEngine {
  return new UnavailableLocalOcrEngine()
}

export function localOcrResultMetadata(result: LocalOcrRecognitionResult): Record<string, unknown> {
  return {
    ...(result.metadata ?? {}),
    ...(typeof result.confidence === "number" ? { confidence: result.confidence } : {}),
  }
}
