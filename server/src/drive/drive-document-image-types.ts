export interface DriveMarkdownImageOccurrence {
  readonly src: string
  readonly altText?: string
}

export interface DriveMarkdownImageReference {
  readonly id: string
  readonly imageKey: string
  readonly src: string
  readonly occurrenceCount: number
  readonly altText?: string
}

export interface DriveMarkdownImageReplaceResult {
  readonly markdown: string
  readonly replacedOccurrenceCount: number
}
