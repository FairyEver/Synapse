import type {
  TextExtractionErrorCode,
} from "../shared/errors"

export type TextExtractionWorkerInput = {
  readonly bytes: ArrayBuffer
  readonly format: "pdf" | "docx"
  readonly maxPages: number
  readonly maxTextBytes: number
}

export type TextExtractionWorkerMessage =
  | {
    readonly type: "success"
    readonly result: {
      readonly text: string
      readonly pages?: number
      readonly warningCount?: number
      readonly warningCategories?: readonly string[]
    }
  }
  | {
    readonly type: "error"
    readonly code: TextExtractionErrorCode
  }
