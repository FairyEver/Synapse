import type { ContentStoreFileKind, ContentStoreType } from "@synapse/shared"
import type { Readable } from "node:stream"

export type ContentStoreFileInput = {
  readonly path: string
  readonly bytes: Buffer
  readonly mimeType?: string | null
}

export type NormalizedContentStoreFile = {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: ContentStoreFileKind
  readonly mimeType: string | null
  readonly text: string | null
  readonly bytes: Buffer
}

export type ContentStorePackageInput = {
  readonly contentId: string
  readonly versionId: string
  readonly type: Extract<ContentStoreType, "skill" | "rule">
  readonly title: string
  readonly files: readonly NormalizedContentStoreFile[]
}

export type ContentStorePackageStreamFile = Omit<NormalizedContentStoreFile, "bytes"> & {
  readonly stream: Readable
}
