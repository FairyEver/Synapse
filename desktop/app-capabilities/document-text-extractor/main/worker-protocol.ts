import type {
  DocumentTextExtractionErrorCode,
} from "../shared/errors"

export type DocumentTextExtractionWorkerInput = {
  readonly bytes: ArrayBuffer
  readonly maxPages: number
  readonly maxTextBytes: number
}

export type DocumentTextExtractionWorkerMessage =
  | {
    readonly type: "success"
    readonly result: {
      readonly text: string
      readonly pages: number
    }
  }
  | {
    readonly type: "error"
    readonly code: DocumentTextExtractionErrorCode
  }
