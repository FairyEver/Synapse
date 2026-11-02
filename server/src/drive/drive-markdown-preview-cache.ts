import { createHash } from 'node:crypto'
import type { DriveMarkdownProjectionDto } from '@synapse/shared'
import { AnnotationComputationCache } from './drive-annotation-cache'
import { DRIVE_MARKDOWN_PARSER_VERSION, DRIVE_MARKDOWN_PROJECTION_SCHEMA_VERSION } from './drive-markdown-projection'
import { prepareDriveMarkdownDocument, type PreparedDriveMarkdownDocument } from './drive-markdown-renderer'
import { measureDrivePreview, recordDrivePreviewCache } from './drive-preview-diagnostics'

export type CachedDriveMarkdownPreview = { readonly document: PreparedDriveMarkdownDocument; readonly truncated: boolean }
type Input = {
  readonly itemId: string
  readonly versionId: string | null
  readonly storageKey: string
  readonly allowStandaloneRawImages: boolean
  readonly live?: { readonly epoch: string; readonly sourceText: string; readonly projectionSource: string; readonly projection: DriveMarkdownProjectionDto } | null
}
type Dependencies = {
  readonly readSource: () => Promise<{ text: string; truncated: boolean }>
  readonly getRevision: () => Promise<string | null>
  readonly loadProjection: () => Promise<DriveMarkdownProjectionDto | null>
  readonly loadPrevious: () => Promise<{ source: string; projection: DriveMarkdownProjectionDto } | null>
  readonly persist: (projection: DriveMarkdownProjectionDto) => Promise<void>
}

export async function loadDriveMarkdownPreview(
  cache: AnnotationComputationCache<CachedDriveMarkdownPreview>, input: Input, dependencies: Dependencies,
): Promise<CachedDriveMarkdownPreview> {
  const live = input.live
  const revision = live ? hash(JSON.stringify([live.sourceText, live.projectionSource, live.projection]))
    : await measureDrivePreview('projection.read', dependencies.getRevision)
  const key = (digest: string | null) => JSON.stringify([input.itemId, input.versionId, input.storageKey,
    DRIVE_MARKDOWN_PARSER_VERSION, input.allowStandaloneRawImages, live?.epoch ?? null, digest])
  const load = async (): Promise<CachedDriveMarkdownPreview> => {
    const source = live ? { text: live.sourceText, truncated: false } : await measureDrivePreview('source', dependencies.readSource)
    const stored = live?.projection ?? (input.versionId ? await measureDrivePreview('projection.read', dependencies.loadProjection) : null)
    const sourceSha256 = hash(source.text)
    const matches = stored?.sourceSha256 === sourceSha256
      && stored.parserVersion === DRIVE_MARKDOWN_PARSER_VERSION
      && stored.schemaVersion === DRIVE_MARKDOWN_PROJECTION_SCHEMA_VERSION && stored.imageAnchorsVersion === 1
    const previous = matches ? null : live
      ? { source: live.projectionSource, projection: live.projection }
      : stored?.sourceSha256 === sourceSha256 ? { source: source.text, projection: stored }
        : input.versionId ? await measureDrivePreview('projection.previous', dependencies.loadPrevious) : null
    const document = await measureDrivePreview('parse', () => prepareDriveMarkdownDocument(source.text, {
      allowStandaloneRawImages: input.allowStandaloneRawImages,
      projection: matches ? stored : null,
      previousProjection: previous,
    }))
    if (!live && input.versionId && !source.truncated && !matches) {
      await measureDrivePreview('projection.persist', () => dependencies.persist(document.projection))
    }
    return { document, truncated: source.truncated }
  }
  if (!input.versionId) return load()
  const result = await cache.get(key(revision), load, (value) => key(live ? revision : hash(JSON.stringify(value.document.projection))))
  recordDrivePreviewCache(result.status)
  return result.value
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
