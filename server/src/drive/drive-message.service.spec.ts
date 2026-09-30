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
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  }
  const drive = { resolveShareAnnotationAccess: vi.fn() }
  const bus = { publish: vi.fn() }
  const service = new DriveMessageService(prisma as never, drive as never, undefined, bus as never)

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('lists owned messages with author and owner permissions', async () => {
    const result = await service.list({ kind: 'owned', itemId: 'doc' }, 'owner')
    expect(result.canPost).toBe(true)
    expect(result.messages[0]?.permissions).toEqual({ canEdit: false, canDelete: true })
    expect(result.messages[0]?.comments[0]?.permissions).toEqual({ canEdit: false, canDelete: true })
    expect(prisma.driveItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'owner', id: 'doc' }) }))
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
    expect(prisma.driveMessageComment.findFirst).toHaveBeenCalledWith({ where: { id: 'first', messageId: 'message', deletedAt: null } })
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
