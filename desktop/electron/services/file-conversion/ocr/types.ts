export interface LocalOcrWarning {
  readonly code: string
  readonly message: string
}

export interface LocalOcrRecognitionResult {
  readonly text: string
  readonly confidence?: number
  readonly metadata?: Record<string, unknown>
  readonly warnings?: readonly LocalOcrWarning[]
}

export interface LocalOcrEngine {
  recognize(input: { readonly filePath: string; readonly mimeType?: string }): Promise<LocalOcrRecognitionResult>
}
