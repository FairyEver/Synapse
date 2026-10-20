import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveMessageService, parseDriveMessageBody } from './drive-message.service'

const time = new Date('2026-09-30T00:00:00.000Z')
const owner = { id: 'owner', email: 'owner@example.com', handle: 'owner' }
const reader = { id: 'reader', email: 'reader@example.com', handle: 'reader' }
const item = { id: 'doc', userId: 'owner', name: 'note.md', type: 'file', mimeType: 'text/markdown' }
const reply = (id: string, parentCommentId: string | null = null, createdByUserId = 'reader') => ({
  id, messageId: 'message', parentCommentId, body: id, createdByUserId,
  createdByUser: createdByUserId === 'owner' ? owner : reader,
  createdAt: time, updatedAt: time, editedAt: null, deletedAt: null,
})
const message = (createdByUserId = 'reader', comments = [reply('first')]) => ({
  id: 'message', itemId: 'doc', body: 'hello', createdByUserId,
  createdByUser: createdByUserId === 'owner' ? owner : reader,
  createdAt: time, updatedAt: time, editedAt: null, deletedAt: null, comments,
})

describe('DriveMessageService', () => {
  const prisma = {
    driveItem: { findFirst: vi.fn() },
    driveMessage: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    driveMessageComment: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (operations: unknown): Promise<unknown> => Array.isArray(operations) ? Promise.all(operations) : (operations as (tx: unknown) => Promise<unknown>)(prisma)),
  }
  const drive = { resolveShareAnnotationAccess: vi.fn(), validateDiscussionWriteAccess: vi.fn(async () => undefined) }
  const bus = { publish: vi.fn() }
  const images = { activateReferencedImages: vi.fn(async () => undefined), prepareUpload: vi.fn(), completeUpload: vi.fn(), cancelUpload: vi.fn() }
  const discussion = {
    mutate: async (_id: string, work: (tx: unknown) => Promise<{ result: unknown }>) => (await prisma.$transaction(work) as { result: unknown }).result,
    withItemLock: async (_id: string, work: (tx: unknown) => Promise<unknown>) => prisma.$transaction(work),
  }
  const service = new DriveMessageService(prisma as never, drive as never, discussion as never, undefined, bus as never, images as never)

  beforeEach(() => {
    vi.clearAllMocks()
    drive.validateDiscussionWriteAccess.mockReset().mockResolvedValue(undefined)
    prisma.driveItem.findFirst.mockResolvedValue(item)
    prisma.driveMessage.findMany.mockResolvedValue([message()])
    prisma.driveMessage.findFirst.mockResolvedValue(message())
    prisma.driveMessage.findUnique.mockResolvedValue(null)
    prisma.driveMessage.create.mockResolvedValue(message('owner'))
    prisma.driveMessage.update.mockResolvedValue(message())
    prisma.driveMessageComment.findFirst.mockResolvedValue(reply('first'))
    prisma.driveMessageComment.findMany.mockResolvedValue([reply('first'), reply('second', 'first'), reply('third', 'second'), reply('other')])
    prisma.driveMessageComment.create.mockResolvedValue(reply('second', 'first', 'owner'))
    prisma.driveMessageComment.update.mockResolvedValue(reply('first'))
    prisma.driveMessageComment.updateMany.mockResolvedValue({ count: 3 })
    drive.resolveShareAnnotationAccess.mockResolvedValue({ item, canComment: true })
  })
  it('rejects permission withdrawn while waiting before saving content or publishing an event', async () => {
    drive.resolveShareAnnotationAccess.mockResolvedValue({ item, canComment: true, sourceShareId: 'original' })
    drive.validateDiscussionWriteAccess.mockRejectedValueOnce(new NotFoundException('分享已停用'))
    await expect(service.create({ kind: 'share', shareId: 'public', itemId: item.id }, reader.id, '新留言')).rejects.toMatchObject({ status: 404 })
    expect(prisma.driveMessage.create).not.toHaveBeenCalled()
    expect(bus.publish).not.toHaveBeenCalled()
  })

  it('does not publish a creation when its notification transaction fails', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('notification store unavailable'))
    await expect(service.create({ kind: 'owned', itemId: 'doc' }, 'owner', 'hello')).rejects.toThrow('notification store unavailable')
    expect(bus.publish).not.toHaveBeenCalled()
  })

  it('lists owned messages with author and owner permissions', async () => {
    const result = await service.list({ kind: 'owned', itemId: 'doc' }, 'owner')
    expect(result.canPost).toBe(true)
    expect(result.messages[0]?.permissions).toEqual({ canEdit: false, canDelete: true })
    expect(result.messages[0]?.comments[0]?.permissions).toEqual({ canEdit: false, canDelete: true })
    expect(prisma.driveItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'owner', id: 'doc' }) }))
  })

  it('renders historical message and reply Markdown while escaping HTML and unsafe URLs', async () => {
    prisma.driveMessage.findMany.mockResolvedValue([{ ...message(), body: '**重点**\n\n<script>alert(1)</script>\n\n[打开](javascript:alert(1))', comments: [{ ...reply('first'), body: '![截图](/object/img_example)' }] }])
    const result = await service.list({ kind: 'owned', itemId: 'doc' }, 'owner')
    expect(result.messages[0]?.bodyHtml).toContain('<strong>重点</strong>')
    expect(result.messages[0]?.bodyHtml).not.toContain('<script>')
    expect(result.messages[0]?.bodyHtml).not.toContain('href="javascript:')
    expect(result.messages[0]?.comments[0]?.bodyHtml).toContain('src="/object/img_example"')
  })

  it('activates images in the same transaction as each message and reply write', async () => {
    const access = { kind: 'share' as const, shareId: 'share', itemId: 'doc' }
    const body = '![截图](/object/img_example)'
    prisma.driveMessageComment.create.mockResolvedValueOnce({ ...reply('second'), body })
    await service.create(access, 'reader', body)
    await service.createComment(access, 'reader', 'message', null, body)
    await service.update(access, 'reader', 'message', body)
    await service.updateComment(access, 'reader', 'first', body)
    expect(images.activateReferencedImages).toHaveBeenCalledTimes(4)
    for (const [tx, input] of images.activateReferencedImages.mock.calls as unknown as [unknown, unknown][]) {
      expect(tx).toBe(prisma)
      expect(input).toEqual({ sourceItemId: 'doc', markdown: body })
    }
    expect(drive.validateDiscussionWriteAccess).toHaveBeenCalledTimes(4)
  })

  it('does not activate images when a write or access recheck fails', async () => {
    prisma.driveMessage.create.mockRejectedValueOnce(new Error('write failed'))
    await expect(service.create({ kind: 'owned', itemId: 'doc' }, 'owner', '![图](/object/img_example)')).rejects.toThrow('write failed')
    expect(images.activateReferencedImages).not.toHaveBeenCalled()
    drive.validateDiscussionWriteAccess.mockRejectedValueOnce(new NotFoundException('分享已停用'))
    await expect(service.update({ kind: 'share', shareId: 'share', itemId: 'doc' }, 'reader', 'message', 'changed')).rejects.toMatchObject({ status: 404 })
    expect(prisma.driveMessage.update).not.toHaveBeenCalled()
  })

  it('allows a logged-in read-only share reader to upload images using discussion access', async () => {
    const access = { kind: 'share' as const, shareId: 'share', itemId: 'doc', cookie: 'access-cookie' }
    images.prepareUpload.mockResolvedValue({ sessionId: 'session' })
    images.completeUpload.mockResolvedValue({ url: '/object/img_example' })
    expect(await service.prepareImageUpload(access, 'reader', { name: '截图.png', size: '12', mimeType: 'image/png' })).toEqual({ sessionId: 'session' })
    expect(await service.completeImageUpload(access, 'reader', 'session')).toEqual({ url: '/object/img_example' })
    expect(images.prepareUpload).toHaveBeenCalledWith({ actorUserId: 'reader', sourceItemId: 'doc', name: '截图.png', size: '12', mimeType: 'image/png' })
    expect(images.completeUpload).toHaveBeenCalledWith({ actorUserId: 'reader', sourceItemId: 'doc', sessionId: 'session' })
    expect(drive.validateDiscussionWriteAccess).toHaveBeenCalledWith(prisma, expect.objectContaining({ actorUserId: 'reader', shareId: 'share', cookie: 'access-cookie' }))
  })

  it('rejects upload preparation and completion after share access is withdrawn', async () => {
    drive.validateDiscussionWriteAccess.mockRejectedValueOnce(new NotFoundException('分享已停用'))
    await expect(service.prepareImageUpload({ kind: 'share', shareId: 'share' }, 'reader', { name: 'image.png', size: '12', mimeType: 'image/png' })).rejects.toMatchObject({ status: 404 })
    expect(images.prepareUpload).not.toHaveBeenCalled()
    drive.validateDiscussionWriteAccess.mockRejectedValueOnce(new NotFoundException('分享已停用'))
    await expect(service.completeImageUpload({ kind: 'share', shareId: 'share' }, 'reader', 'session')).rejects.toMatchObject({ status: 404 })
    expect(images.completeUpload).not.toHaveBeenCalled()
  })

  it('rejects anonymous image uploads before accessing storage', async () => {
    await expect(service.prepareImageUpload({ kind: 'share', shareId: 'share' }, null as never, { name: 'image.png', size: '12', mimeType: 'image/png' })).rejects.toMatchObject({ status: 403 })
    expect(images.prepareUpload).not.toHaveBeenCalled()
  })

  it('allows anonymous share readers to view redacted messages but not post', async () => {
    const access = { kind: 'share' as const, shareId: 'share', itemId: 'doc' }
    const result = await service.list(access, null)
    expect(result.canPost).toBe(false)
    expect(result.messages[0]?.author.email).toBeNull()
    expect(result.messages[0]?.permissions).toEqual({ canEdit: false, canDelete: false })
    expect(drive.resolveShareAnnotationAccess).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: null, shareId: 'share' }))
  })

  it('reuses an Open API comment for the same idempotency key and rejects changed content', async () => {
    const access = { kind: 'share' as const, shareId: 'share', itemId: 'doc' }
    const idempotency = { keyHash: 'key-hash', requestHash: 'request-hash' }
    prisma.driveMessage.findUnique.mockResolvedValue({ ...message('reader', []), openApiRequestHash: 'request-hash' })

    const replayed = await service.create(access, 'reader', 'hello', undefined, idempotency)
    expect(replayed.id).toBe('message')
    expect(prisma.driveMessage.create).not.toHaveBeenCalled()
    expect(bus.publish).not.toHaveBeenCalled()

    await expect(service.create(access, 'reader', 'different', undefined, {
      ...idempotency, requestHash: 'different-hash',
    })).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.driveMessage.create).not.toHaveBeenCalled()
  })

  it('stores only hashes for a newly created Open API comment', async () => {
    const idempotency = { keyHash: 'key-hash', requestHash: 'request-hash' }
    await service.create({ kind: 'share', shareId: 'share', itemId: 'doc' }, 'reader', ' hello ', undefined, idempotency)
    expect(prisma.driveMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        body: 'hello', openApiIdempotencyHash: 'key-hash', openApiRequestHash: 'request-hash',
      }),
    }))
    expect(bus.publish).toHaveBeenCalledWith('doc', { type: 'message.changed', itemId: 'doc' })
  })

  it('returns the original comment when two retries race to create it', async () => {
    prisma.driveMessage.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', { code: 'P2002', clientVersion: '6.19.3' },
    ))
    prisma.driveMessage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...message('reader', []), openApiRequestHash: 'request-hash' })

    const result = await service.create(
      { kind: 'share', shareId: 'share', itemId: 'doc' }, 'reader', 'hello', undefined,
      { keyHash: 'key-hash', requestHash: 'request-hash' },
    )
    expect(result.id).toBe('message')
    expect(bus.publish).not.toHaveBeenCalled()
  })

  it('lets an authenticated share reader edit their own message and reply at any depth', async () => {
    const access = { kind: 'share' as const, shareId: 'share', itemId: 'doc', password: 'secret' }
    const listed = await service.list(access, 'reader')
    expect(listed.canPost).toBe(true)
    expect(listed.messages[0]?.permissions).toEqual({ canEdit: true, canDelete: true })
    const edited = await service.update(access, 'reader', 'message', ' changed ')
    expect(edited.author.email).toBeNull()
    expect(prisma.driveMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ body: 'changed' }) }))
    await service.createComment(access, 'reader', 'message', 'first', 'nested')
    expect(prisma.driveMessageComment.findFirst).toHaveBeenCalledWith({ where: { id: 'first', messageId: 'message', deletedAt: null }, include: { createdByUser: { select: { handle: true } } } })
    expect(drive.resolveShareAnnotationAccess).toHaveBeenCalledWith(expect.objectContaining({ password: 'secret', actorUserId: 'reader' }))
  })

  it('blocks a readable non-author from editing or deleting another user’s content', async () => {
    const access = { kind: 'share' as const, shareId: 'share', itemId: 'doc' }
    await expect(service.update(access, 'other', 'message', 'changed')).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.delete(access, 'other', 'message')).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.updateComment(access, 'other', 'first', 'changed')).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.deleteComment(access, 'other', 'first')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('only lets the author edit, while the owner may delete', async () => {
    await expect(service.update({ kind: 'owned', itemId: 'doc' }, 'owner', 'message', 'changed')).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.updateComment({ kind: 'owned', itemId: 'doc' }, 'owner', 'first', 'changed')).rejects.toBeInstanceOf(ForbiddenException)
    await service.delete({ kind: 'owned', itemId: 'doc' }, 'owner', 'message')
    expect(prisma.driveMessageComment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { messageId: 'message', deletedAt: null } }))
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(bus.publish).toHaveBeenCalledWith('doc', { type: 'message.changed', itemId: 'doc' })
  })

  it('rejects cross-message parents and deletes every descendant of a reply', async () => {
    prisma.driveMessageComment.findFirst.mockResolvedValueOnce(null)
    await expect(service.createComment({ kind: 'owned', itemId: 'doc' }, 'owner', 'message', 'foreign', 'hi')).rejects.toBeInstanceOf(BadRequestException)
    await service.deleteComment({ kind: 'owned', itemId: 'doc' }, 'owner', 'first')
    expect(prisma.driveMessageComment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: expect.arrayContaining(['first', 'second', 'third']) }, deletedAt: null },
    }))
    const ids = prisma.driveMessageComment.updateMany.mock.calls[0]?.[0].where.id.in
    expect(ids).not.toContain('other')
  })

  it('rejects unrelated readers and missing Markdown files', async () => {
    prisma.driveItem.findFirst.mockResolvedValueOnce(null)
    await expect(service.list({ kind: 'owned', itemId: 'doc' }, 'reader')).rejects.toBeInstanceOf(NotFoundException)
    prisma.driveItem.findFirst.mockResolvedValueOnce({ ...item, name: 'photo.png', mimeType: 'image/png' })
    await expect(service.list({ kind: 'owned', itemId: 'doc' }, 'owner')).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('parseDriveMessageBody', () => {
  it('trims boundaries, preserves line breaks and enforces length', () => {
    expect(parseDriveMessageBody('  one\ntwo  ')).toBe('one\ntwo')
    expect(() => parseDriveMessageBody('  ')).toThrow(BadRequestException)
    expect(() => parseDriveMessageBody('x'.repeat(4001))).toThrow(BadRequestException)
  })
})
