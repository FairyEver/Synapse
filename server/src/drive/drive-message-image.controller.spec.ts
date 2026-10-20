import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { describe, expect, it, vi } from 'vitest'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { DrivePublicController, DriveUserController } from './drive.controller'

describe('message image upload endpoints', () => {
  const images = { prepareImageUpload: vi.fn(), completeImageUpload: vi.fn(), cancelImageUpload: vi.fn() }
  const owner = new DriveUserController({} as never, undefined, undefined, undefined, undefined, undefined, images as never)
  const share = new DrivePublicController({} as never, {} as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, images as never)
  const request = { user: { id: 'reader' }, headers: {} } as never

  it('requires login for all shared image upload operations', () => {
    for (const method of ['prepareShareMessageImageUpload', 'completeShareMessageImageUpload', 'cancelShareMessageImageUpload'] as const) {
      const handler = share[method]
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(UserAuthGuard)
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toEqual(expect.arrayContaining([
        expect.stringContaining('/shares/:shareId/messages/images/uploads/'),
        expect.stringContaining('/shares/:shareId/items/:itemId/messages/images/uploads/'),
      ]))
    }
  })

  it('validates upload metadata and preserves owner/share target identity', async () => {
    const input = { name: 'screenshot.png', size: '12', mimeType: 'image/png' }
    await owner.prepareOwnerMessageImageUpload('doc', input, request)
    expect(images.prepareImageUpload).toHaveBeenLastCalledWith({ kind: 'owned', itemId: 'doc' }, 'reader', input)
    await share.prepareShareMessageImageUpload('public', 'child', input, request)
    expect(images.prepareImageUpload).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'share', shareId: 'public', itemId: 'child' }), 'reader', input)
    expect(() => owner.prepareOwnerMessageImageUpload('doc', { ...input, unexpected: true }, request)).toThrow()
    await share.completeShareMessageImageUpload('public', 'child', 'session', request)
    expect(images.completeImageUpload).toHaveBeenLastCalledWith(expect.objectContaining({ shareId: 'public', itemId: 'child' }), 'reader', 'session')
  })
})
