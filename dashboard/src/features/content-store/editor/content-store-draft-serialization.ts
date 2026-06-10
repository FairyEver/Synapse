import type {
  CreateContentStoreDraftInput,
  SaveContentStoreDraftInput,
} from '@/lib/api'
import type { ContentStoreDraftFormState } from './content-store-editor-types'

export function serializeDraftForCreate(
  state: ContentStoreDraftFormState
): CreateContentStoreDraftInput {
  const description = normalizeDescription(state.description)
  if (state.type === 'skill') {
    return {
      type: 'skill',
      title: state.title.trim(),
      description,
      files: state.files.map((file) => ({
        path: file.path,
        contentBase64: file.bytesBase64,
        mimeType: file.mimeType,
      })),
    }
  }
  return {
    type: state.type,
    title: state.title.trim(),
    description,
    body: state.body,
  }
}

export function serializeDraftForSave(
  state: ContentStoreDraftFormState & { baseRevision: number }
): SaveContentStoreDraftInput {
  const description = normalizeDescription(state.description)
  if (state.type === 'skill') {
    return {
      type: 'skill',
      baseRevision: state.baseRevision,
      title: state.title.trim(),
      description,
      files: state.files.map((file) => ({
        path: file.path,
        contentBase64: file.bytesBase64,
        mimeType: file.mimeType,
      })),
    }
  }
  return {
    type: state.type,
    baseRevision: state.baseRevision,
    title: state.title.trim(),
    description,
    body: state.body,
  }
}

function normalizeDescription(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
