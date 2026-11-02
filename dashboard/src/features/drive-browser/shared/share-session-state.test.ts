import { describe, expect, it } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { shareSnapshotForSession } from './share-session-state'

describe('share session startup', () => {
  it('keeps content readable while withholding write capabilities until session resolution', () => {
    const original = {
      context: 'share', preview: { text: '正文' }, edit: { canEdit: true },
      annotation: { canComment: true }, collaboration: { enabled: true, canWrite: true },
    } as DriveBrowserSnapshotDto
    const waiting = shareSnapshotForSession(original, false)
    expect(waiting.preview).toBe(original.preview)
    expect(waiting.edit?.canEdit).toBe(false)
    expect(waiting.annotation?.canComment).toBe(false)
    expect(waiting.collaboration).toMatchObject({ enabled: false, canWrite: false })
    expect(original.edit?.canEdit).toBe(true)
    expect(shareSnapshotForSession(original, true)).toBe(original)
    const owner = { ...original, context: 'owner' as const }
    expect(shareSnapshotForSession(owner, false)).toBe(owner)
  })
})
