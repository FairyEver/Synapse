import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { measureDrivePreview, recordDrivePreviewCache, traceDrivePreview } from './drive-preview-diagnostics'

describe('preview performance diagnostics', () => {
  it('isolates concurrent traces and logs only numerical measurements and fixed labels', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    try {
      const results = await Promise.all([
        traceDrivePreview('owner', () => measureDrivePreview('source', async () => { recordDrivePreviewCache('hit'); return 'private document' })),
        traceDrivePreview('share', () => measureDrivePreview('access', async () => { recordDrivePreviewCache('shared'); return 'secret-password' })),
      ])
      expect(results).toEqual(['private document', 'secret-password'])
      const values = log.mock.calls.map(([value]) => value)
      expect(values).toHaveLength(2)
      expect(values).toContainEqual(expect.objectContaining({ context: 'owner', cacheHit: 1, shared: 0, success: true }))
      expect(values).toContainEqual(expect.objectContaining({ context: 'share', cacheHit: 0, shared: 1, success: true }))
      expect(JSON.stringify(values)).not.toMatch(/private document|secret-password/u)
    } finally { log.mockRestore() }
  })
})
