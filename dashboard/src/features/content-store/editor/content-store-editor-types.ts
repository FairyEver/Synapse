import type { ContentStoreType } from '@synapse/shared'

export type SkillEditorFile = {
  path: string
  kind: 'text' | 'binary'
  text: string
  bytesBase64: string
  size: number
  mimeType: string | null
  sha256: string
}

export type ContentStoreDraftFormState = {
  type: ContentStoreType
  title: string
  description: string
  body: string
  files: SkillEditorFile[]
}

export type ContentStoreEditorMode = 'create' | 'edit'
