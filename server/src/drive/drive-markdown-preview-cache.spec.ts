import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AnnotationComputationCache } from './drive-annotation-cache'
import { loadDriveMarkdownPreview, type CachedDriveMarkdownPreview } from './drive-markdown-preview-cache'
import { prepareDriveMarkdownDocument } from './drive-markdown-renderer'

function fixture() {
  let source = '# Title\n\nbody'
  let projection: Awaited<ReturnType<typeof prepareDriveMarkdownDocument>>['projection'] | null = null
  let failPersist = false
  const dependencies = {
    readSource: vi.fn(async () => ({ text: source, truncated: false })),
    getRevision: vi.fn(async () => projection ? createHash('sha256').update(JSON.stringify(projection)).digest('hex') : null),
    loadProjection: vi.fn(async () => projection),
    loadPrevious: vi.fn(async () => null),
    persist: vi.fn(async (value: NonNullable<typeof projection>) => { if (!failPersist) projection = value }),
  }
  const cache = new AnnotationComputationCache<CachedDriveMarkdownPreview>({ maxEntries: 16, maxBytes: 32 * 1024 * 1024, sizeOf: (v) => JSON.stringify(v).length * 2 })
  const input = { itemId: 'item', versionId: 'v1', storageKey: 'object', allowStandaloneRawImages: true }
  return { dependencies, cache, input, setSource: (value: string) => { source = value }, setProjection: (value: typeof projection) => { projection = value }, failPersistence: () => { failPersist = true } }
}

describe('Markdown preview cache', () => {
  it('shares concurrent parsing and reuses persisted revisions without rewriting', async () => {
    const f = fixture()
    const [a, b] = await Promise.all([loadDriveMarkdownPreview(f.cache, f.input, f.dependencies), loadDriveMarkdownPreview(f.cache, f.input, f.dependencies)])
    const c = await loadDriveMarkdownPreview(f.cache, f.input, f.dependencies)
    expect(a.document.projection).toBe(b.document.projection)
    expect(c.document).toBe(a.document)
    expect(f.dependencies.readSource).toHaveBeenCalledTimes(1)
    expect(f.dependencies.persist).toHaveBeenCalledTimes(1)
  })

  it('uses matching current projections without loading previous versions or persisting', async () => {
    const f = fixture()
    const current = await prepareDriveMarkdownDocument('# Title\n\nbody')
    f.setProjection(current.projection)
    const result = await loadDriveMarkdownPreview(f.cache, f.input, f.dependencies)
    expect(result.document.projection).toBe(current.projection)
    expect(f.dependencies.loadPrevious).not.toHaveBeenCalled()
    expect(f.dependencies.persist).not.toHaveBeenCalled()
  })

  it('invalidates a rebuilt projection even when the file version did not change', async () => {
    const f = fixture()
    const a = await loadDriveMarkdownPreview(f.cache, f.input, f.dependencies)
    const updated = structuredClone(a.document.projection)
    f.setProjection({ ...updated, blocks: updated.blocks.map((block, index) => index === 0 ? { ...block, blockId: 'rebuilt' } : block) })
    const b = await loadDriveMarkdownPreview(f.cache, f.input, f.dependencies)
    expect(b.document.projection.blocks[0].blockId).toBe('rebuilt')
    expect(f.dependencies.readSource).toHaveBeenCalledTimes(2)
  })

  it('invalidates changed versions and retries unpersisted projections', async () => {
    const f = fixture()
    f.failPersistence()
    await loadDriveMarkdownPreview(f.cache, f.input, f.dependencies)
    await loadDriveMarkdownPreview(f.cache, f.input, f.dependencies)
    expect(f.dependencies.persist).toHaveBeenCalledTimes(2)
    f.setSource('new content')
    const next = await loadDriveMarkdownPreview(f.cache, { ...f.input, versionId: 'v2', storageKey: 'object2' }, f.dependencies)
    expect(next.document.renderedText).toBe('new content')
  })

  it('does not persist live revisions to checkpoint versions and keys by live content', async () => {
    const f = fixture()
    const live = await prepareDriveMarkdownDocument('live')
    const state = { epoch: 'epoch', sourceText: 'live', projectionSource: 'live', projection: live.projection }
    const first = await loadDriveMarkdownPreview(f.cache, { ...f.input, live: state }, f.dependencies)
    const second = await loadDriveMarkdownPreview(f.cache, { ...f.input, live: { ...state, sourceText: 'edited' } }, f.dependencies)
    expect(first.document.renderedText).toBe('live')
    expect(second.document.renderedText).toBe('edited')
    expect(f.dependencies.readSource).not.toHaveBeenCalled()
    expect(f.dependencies.persist).not.toHaveBeenCalled()
  })
})
