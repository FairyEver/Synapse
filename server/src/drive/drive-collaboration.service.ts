import { BadRequestException, ConflictException, Inject, Injectable, Logger, OnApplicationShutdown } from "@nestjs/common"
import { codePointCount, DRIVE_MAX_FILE_BYTES, DRIVE_MAX_FILE_SIZE_LABEL, type DriveAnnotationCrdtRangeSelector, type DriveAnnotationTextPositionSelector, type DriveCollaborationControlMessage, type DriveFileContentUpdateResult, type DriveMarkdownOutlineItemDto, type DriveMarkdownProjectionDto } from "@synapse/shared"
import { createHash, randomUUID } from "node:crypto"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { Prisma } from "@prisma/client"
import { loadEnv } from "../config/env"
import { PrismaService } from "../prisma/prisma.service"
import { DriveChangeLogService } from "./drive-change-log"
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"
import { isPlainDriveMarkdownName } from "./drive-markdown-relative-images"
import { DriveMarkdownProjectionService } from "./drive-markdown-projection.service"
import type { DriveStoragePort } from "./drive-storage"
import { DRIVE_ITEM_LIFECYCLE_STATUS, DRIVE_ITEM_TYPE, DRIVE_STORAGE_STATUS, DRIVE_UPLOAD_STATUS } from "./drive.constants"
import { commitDriveUsageReservation, releaseDriveUsageReservation, reserveDriveUsageBytes } from "./drive-usage"
import { createDriveFileVersion, createDriveFileVersionId, DRIVE_FILE_VERSION_SOURCE, driveVersionStorageKey, toDriveFileVersionDto } from "./drive-version-history"
import { LocalDriveCollaborationBus } from "./drive-collaboration-bus"
import { toDriveItemDto } from "./drive.types"

export type DriveCollaborationConnection = {
  readonly clientId: string
  readonly userId: string | null
  readonly canWrite: boolean
  readonly sendUpdate: (update: Uint8Array) => void
  readonly sendAwareness: (update: Uint8Array) => void
  readonly sendControl: (message: DriveCollaborationControlMessage) => void
  readonly close: (code: number, reason: string) => void
  readonly revalidate: () => Promise<boolean>
}

export type DriveCollaborationAccess = {
  readonly itemId: string
  readonly ownerId: string
  readonly itemName: string
  readonly mimeType: string | null
  readonly canWrite: boolean
  readonly userId: string | null
}

type PendingUpdate = {
  readonly update: Uint8Array
  readonly connection: DriveCollaborationConnection
  readonly updateId: string
}

type ContributorRange = { start: bigint; end: bigint }

type CollaborationRoom = {
  readonly itemId: string
  readonly ownerId: string
  readonly itemName: string
  readonly mimeType: string | null
  readonly doc: Y.Doc
  readonly text: Y.Text
  readonly awareness: Awareness
  readonly connections: Map<string, DriveCollaborationConnection>
  readonly contributors: Map<string, ContributorRange>
  projectionState: {
    readonly source: string
    readonly html: string
    readonly outline: readonly DriveMarkdownOutlineItemDto[]
    readonly projection: DriveMarkdownProjectionDto
  }
  epoch: string
  checkpointVersionId: string
  durableSequence: bigint
  checkpointSequence: bigint
  reservedBytes: bigint
  pending: PendingUpdate[]
  pendingBytes: number
  flushTimer: NodeJS.Timeout | null
  flushPromise: Promise<void> | null
  idleCheckpointTimer: NodeJS.Timeout | null
  maxCheckpointTimer: NodeJS.Timeout | null
  leaveCheckpointTimer: NodeJS.Timeout | null
  previewTimer: NodeJS.Timeout | null
  dirtySince: number | null
  acceptingWrites: boolean
}

const persistenceBatchDelayMs = 250
const persistenceRetryDelayMs = 1_000
const persistenceBatchMaxBytes = 64 * 1024
const idleCheckpointDelayMs = 30_000
const maxCheckpointDelayMs = 5 * 60_000
const leaveCheckpointDelayMs = 5_000
const previewDelayMs = 300
const shutdownPersistenceTimeoutMs = 10_000
const objectReadMaxBytes = DRIVE_MAX_FILE_BYTES
const initializationOrigin = Symbol("drive-collaboration-initialization")

@Injectable()
export class DriveCollaborationService implements OnApplicationShutdown {
  private readonly logger = new Logger(DriveCollaborationService.name)
  private readonly rooms = new Map<string, CollaborationRoom>()
  private readonly enabled = loadEnv(process.env).driveCollaborationEnabled

  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    private readonly projections: DriveMarkdownProjectionService,
    private readonly bus: LocalDriveCollaborationBus,
    private readonly changes: DriveChangeLogService,
  ) {}

  isEnabled(): boolean {
    return this.enabled
  }

  async ensureDocument(itemId: string, checkpointVersionId: string): Promise<{ readonly epoch: string; readonly checkpointVersionId: string }> {
    return this.prisma.$transaction(async (tx) => {
      await lockDriveItem(tx, itemId)
      const existing = await tx.driveCollaborationDocument.findUnique({ where: { itemId } })
      if (existing?.checkpointVersionId === checkpointVersionId) return existing
      return tx.driveCollaborationDocument.upsert({
        where: { itemId },
        create: { itemId, epoch: createEpoch(), checkpointVersionId },
        update: {
          epoch: createEpoch(),
          checkpointVersionId,
          snapshotStorageKey: null,
          snapshotSha256: null,
          durableSequence: 0n,
          checkpointSequence: 0n,
          reservedBytes: 0n,
        },
        select: { epoch: true, checkpointVersionId: true },
      })
    })
  }

  async join(access: DriveCollaborationAccess, connection: DriveCollaborationConnection, expectedEpoch: string | null): Promise<{
    readonly accepted: boolean
    readonly doc: Y.Doc
    readonly epoch: string
    readonly checkpointVersionId: string
    readonly durableSequence: bigint
  }> {
    if (!this.enabled) throw new BadRequestException("实时协同未启用。")
    const room = await this.getOrLoadRoom(access)
    if (expectedEpoch && expectedEpoch !== room.epoch) {
      return {
        accepted: false,
        doc: room.doc,
        epoch: room.epoch,
        checkpointVersionId: room.checkpointVersionId,
        durableSequence: room.durableSequence,
      }
    }
    const previous = room.connections.get(connection.clientId)
    if (previous && previous !== connection) previous.close(1000, "superseded")
    room.connections.set(connection.clientId, connection)
    if (room.leaveCheckpointTimer) {
      clearTimeout(room.leaveCheckpointTimer)
      room.leaveCheckpointTimer = null
    }
    return {
      accepted: true,
      doc: room.doc,
      epoch: room.epoch,
      checkpointVersionId: room.checkpointVersionId,
      durableSequence: room.durableSequence,
    }
  }

  leave(itemId: string, connection: DriveCollaborationConnection): void {
    const room = this.rooms.get(itemId)
    if (!room) return
    if (room.connections.get(connection.clientId) !== connection) return
    room.connections.delete(connection.clientId)
    if ([...room.connections.values()].some((connection) => connection.canWrite)) return
    if (room.leaveCheckpointTimer) clearTimeout(room.leaveCheckpointTimer)
    room.leaveCheckpointTimer = setTimeout(() => {
      room.leaveCheckpointTimer = null
      void this.checkpoint(itemId, "last_editor_left").catch((error: unknown) => {
        this.logRoomFailure(room, "Drive collaboration leave checkpoint failed", error)
      })
    }, leaveCheckpointDelayMs)
    room.leaveCheckpointTimer.unref?.()
  }

  async applyClientUpdate(itemId: string, clientId: string, update: Uint8Array): Promise<void> {
    const room = this.rooms.get(itemId)
    const connection = room?.connections.get(clientId)
    if (!room || !room.acceptingWrites || !connection || !connection.canWrite || !connection.userId) throw new ConflictException("当前连接不可编辑。")
    const candidate = new Y.Doc()
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc), initializationOrigin)
    Y.applyUpdate(candidate, update, initializationOrigin)
    const candidateSize = Buffer.byteLength(candidate.getText("content").toString(), "utf8")
    candidate.destroy()
    if (candidateSize > DRIVE_MAX_FILE_BYTES) {
      const message = `文件超过 ${DRIVE_MAX_FILE_SIZE_LABEL} 限制。`
      connection.sendControl({ type: "error", code: "DRIVE_COLLABORATION_TOO_LARGE", message })
      throw new BadRequestException(message)
    }
    Y.applyUpdate(room.doc, update, connection)
    room.pending.push({ update, connection, updateId: randomUUID() })
    room.pendingBytes += update.byteLength
    if (room.dirtySince === null) {
      room.dirtySince = Date.now()
      this.scheduleMaxCheckpoint(room)
    }
    this.schedulePersistence(room)
  }

  getRoomDocument(itemId: string): Y.Doc | null {
    return this.rooms.get(itemId)?.doc ?? null
  }

  getLiveDocument(itemId: string): {
    readonly sourceText: string
    readonly epoch: string
    readonly checkpointVersionId: string
    readonly projection: DriveMarkdownProjectionDto
    readonly projectionSource: string
  } | null {
    const room = this.rooms.get(itemId)
    return room ? {
      sourceText: room.text.toString(),
      epoch: room.epoch,
      checkpointVersionId: room.checkpointVersionId,
      projection: room.projectionState.projection,
      projectionSource: room.projectionState.source,
    } : null
  }

  getRoomPreview(itemId: string): Extract<DriveCollaborationControlMessage, { readonly type: "preview.changed" }> | null {
    const room = this.rooms.get(itemId)
    if (!room) return null
    return {
      type: "preview.changed",
      itemId: room.itemId,
      epoch: room.epoch,
      stateVector: Buffer.from(Y.encodeStateVector(room.doc)).toString("base64"),
      html: room.projectionState.html,
      outline: room.projectionState.outline,
      projection: room.projectionState.projection,
    }
  }

  resolveRelativeRange(itemId: string, selector: DriveAnnotationCrdtRangeSelector): DriveAnnotationTextPositionSelector | null {
    const room = this.rooms.get(itemId)
    if (!room || room.epoch !== selector.epoch) return null
    try {
      const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(selector.start, "base64")), room.doc)
      const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(selector.end, "base64")), room.doc)
      if (!start || !end || start.type !== room.text || end.type !== room.text || end.index < start.index) return null
      const sourceText = room.text.toString()
      return {
        start: codePointCount(sourceText.slice(0, start.index)),
        end: codePointCount(sourceText.slice(0, end.index)),
      }
    } catch {
      return null
    }
  }

  getRoomAwareness(itemId: string): Awareness | null {
    return this.rooms.get(itemId)?.awareness ?? null
  }

  broadcastAwareness(itemId: string, update: Uint8Array): void {
    const room = this.rooms.get(itemId)
    if (!room) return
    for (const connection of room.connections.values()) connection.sendAwareness(update)
  }

  async checkpoint(itemId: string, reason: string): Promise<DriveFileContentUpdateResult | null> {
    const room = this.rooms.get(itemId)
    if (!room) return null
    await this.flushRoom(room)
    if (room.pending.length > 0) throw new ConflictException("协同更新尚未持久化。")

    const body = Buffer.from(room.text.toString(), "utf8")
    const current = await this.prisma.driveItem.findFirst({
      where: { id: itemId, userId: room.ownerId, type: DRIVE_ITEM_TYPE.file, deletedAt: null, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active },
      include: { fileVersions: { where: { id: room.checkpointVersionId, deletedAt: null }, take: 1 } },
    })
    const checkpointVersion = current?.fileVersions[0]
    if (!current || !checkpointVersion || current.storageKey !== checkpointVersion.storageKey) {
      throw new ConflictException("文件已有新内容。")
    }
    const currentObject = await this.storage.getObjectStream({ key: checkpointVersion.storageKey })
    const currentBody = await readStreamBuffer(currentObject.stream, objectReadMaxBytes)
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(room.doc))
    const snapshotKey = collaborationSnapshotKey(itemId, room.epoch)
    await this.storage.putObject({ key: snapshotKey, body: snapshot, contentType: "application/octet-stream" })

    if (sha256(currentBody) === sha256(body)) {
      await this.prisma.$transaction(async (tx) => {
        await lockDriveItem(tx, itemId)
        if (room.reservedBytes > 0n) await releaseDriveUsageReservation(tx, room.ownerId, room.reservedBytes)
        await tx.driveCollaborationDocument.update({
          where: { itemId },
          data: {
            snapshotStorageKey: snapshotKey,
            snapshotSha256: sha256(snapshot),
            checkpointSequence: room.durableSequence,
            reservedBytes: 0n,
          },
        })
      })
      room.reservedBytes = 0n
      room.checkpointSequence = room.durableSequence
      room.contributors.clear()
      await this.compactSegments(room)
      this.resetCheckpointTimers(room)
      return null
    }

    const versionId = createDriveFileVersionId()
    const versionStorageKey = driveVersionStorageKey(itemId, versionId)
    await this.storage.putObject({ key: versionStorageKey, body, contentType: room.mimeType })
    const result = await this.prisma.$transaction(async (tx) => {
      await lockDriveItem(tx, itemId)
      const latestDocument = await tx.driveCollaborationDocument.findUnique({ where: { itemId } })
      const latestItem = await tx.driveItem.findUnique({ where: { id: itemId } })
      if (!latestDocument || latestDocument.epoch !== room.epoch || latestDocument.checkpointVersionId !== room.checkpointVersionId || latestItem?.storageKey !== checkpointVersion.storageKey) {
        throw new ConflictException("文件已有新内容。")
      }
      if (latestDocument.reservedBytes < BigInt(body.byteLength)) {
        await reserveDriveUsageBytes(tx, room.ownerId, BigInt(body.byteLength) - latestDocument.reservedBytes)
      }
      await createDriveFileVersion(tx, {
        id: versionId,
        itemId,
        userId: room.ownerId,
        storageKey: versionStorageKey,
        size: BigInt(body.byteLength),
        mimeType: room.mimeType,
        source: DRIVE_FILE_VERSION_SOURCE.collaboration,
        createdBy: null,
      })
      for (const [userId, range] of room.contributors) {
        await tx.driveFileVersionContributor.create({
          data: { versionId, userId, sequenceStart: range.start, sequenceEnd: range.end },
        })
      }
      const item = await tx.driveItem.update({
        where: { id: itemId },
        data: {
          storageKey: versionStorageKey,
          size: BigInt(body.byteLength),
          storageStatus: DRIVE_STORAGE_STATUS.active,
          uploadStatus: DRIVE_UPLOAD_STATUS.completed,
        },
        include: { shares: true },
      })
      await commitDriveUsageReservation(tx, room.ownerId, {
        reservedBytes: BigInt(body.byteLength),
        usedBytes: BigInt(body.byteLength),
      })
      await tx.driveCollaborationDocument.update({
        where: { itemId },
        data: {
          checkpointVersionId: versionId,
          checkpointSequence: room.durableSequence,
          snapshotStorageKey: snapshotKey,
          snapshotSha256: sha256(snapshot),
          reservedBytes: 0n,
        },
      })
      await this.changes.append({
        userId: room.ownerId,
        itemId,
        parentId: item.parentId,
        type: "content_updated",
        versionId,
        name: item.name,
        actor: `collaboration:${reason}`,
      }, tx)
      const version = await tx.driveFileVersion.findUniqueOrThrow({ where: { id: versionId } })
      return { item, version }
    }).catch(async (error: unknown) => {
      await this.deleteObjectAfterFailure(room, versionStorageKey, "Drive collaboration checkpoint object cleanup failed")
      throw error
    })

    room.checkpointVersionId = versionId
    room.checkpointSequence = room.durableSequence
    room.reservedBytes = 0n
    room.contributors.clear()
    await this.compactSegments(room)
    this.resetCheckpointTimers(room)
    const rendered = await renderDriveMarkdownFragment(body.toString("utf8"), {
      projection: room.projectionState.projection,
      allowStandaloneRawImages: isPlainDriveMarkdownName(room.itemName),
    })
    await this.projections.persist({ itemId, versionId, projection: rendered.projection })
    this.bus.publish(itemId, {
      type: "checkpoint.changed",
      itemId,
      epoch: room.epoch,
      checkpointVersionId: versionId,
    })
    return {
      item: toDriveItemDto(result.item),
      version: toDriveFileVersionDto(result.version, result.item.storageKey),
    }
  }

  async prepareExternalChange(itemId: string): Promise<void> {
    const room = this.rooms.get(itemId)
    if (!room) return
    room.acceptingWrites = false
    for (const connection of room.connections.values()) {
      if (connection.canWrite) connection.sendControl({ type: "permission_changed", canWrite: false, reason: "epoch_transition" })
    }
    await this.checkpoint(itemId, "external_change")
  }

  resumeExternalChange(itemId: string): void {
    const room = this.rooms.get(itemId)
    if (!room || room.acceptingWrites) return
    room.acceptingWrites = true
    for (const connection of room.connections.values()) {
      if (connection.canWrite) {
        connection.sendControl({ type: "permission_changed", canWrite: true, reason: "external_change_cancelled" })
      }
    }
  }

  async replaceEpochInTransaction(tx: Prisma.TransactionClient, itemId: string, checkpointVersionId: string): Promise<string> {
    const epoch = createEpoch()
    await tx.driveCollaborationDocument.upsert({
      where: { itemId },
      create: { itemId, epoch, checkpointVersionId },
      update: {
        epoch,
        checkpointVersionId,
        snapshotStorageKey: null,
        snapshotSha256: null,
        durableSequence: 0n,
        checkpointSequence: 0n,
        reservedBytes: 0n,
      },
    })
    return epoch
  }

  finalizeExternalChange(itemId: string, epoch: string, checkpointVersionId: string): void {
    const currentRoom = this.rooms.get(itemId)
    this.rooms.delete(itemId)
    const message: DriveCollaborationControlMessage = { type: "epoch_replaced", epoch, checkpointVersionId }
    try {
      this.bus.publish(itemId, message)
    } catch (error) {
      this.logExternalChangeFailure(itemId, epoch, "Drive collaboration epoch notification failed", error)
    }
    for (const connection of currentRoom?.connections.values() ?? []) {
      try {
        connection.sendControl(message)
      } catch (error) {
        this.logExternalChangeFailure(itemId, epoch, "Drive collaboration connection notification failed", error)
      }
      try {
        connection.close(1012, "epoch_replaced")
      } catch (error) {
        this.logExternalChangeFailure(itemId, epoch, "Drive collaboration connection close failed", error)
      }
    }
    try {
      currentRoom?.doc.destroy()
    } catch (error) {
      this.logExternalChangeFailure(itemId, epoch, "Drive collaboration room cleanup failed", error)
    }
  }

  publishAnnotationChanged(itemId: string): void {
    this.bus.publish(itemId, { type: "annotation.changed", itemId })
  }

  async onApplicationShutdown(): Promise<void> {
    const rooms = [...this.rooms.values()]
    await Promise.all(rooms.map(async (room) => {
      try {
        await withTimeout((async () => {
          await this.flushRoom(room)
          await this.checkpoint(room.itemId, "server_shutdown")
        })(), shutdownPersistenceTimeoutMs)
      } catch (error) {
        this.logRoomFailure(room, "Drive collaboration shutdown persistence failed", error)
      }
      for (const connection of room.connections.values()) connection.close(1012, "server_shutdown")
      this.clearRoomTimers(room)
      room.doc.destroy()
    }))
    this.rooms.clear()
  }

  private async getOrLoadRoom(access: DriveCollaborationAccess): Promise<CollaborationRoom> {
    const existing = this.rooms.get(access.itemId)
    if (existing) {
      const durable = await this.prisma.driveCollaborationDocument.findUnique({
        where: { itemId: access.itemId },
        select: { epoch: true, checkpointVersionId: true },
      })
      if (durable?.epoch === existing.epoch && durable.checkpointVersionId === existing.checkpointVersionId) return existing
      this.rooms.delete(access.itemId)
      this.clearRoomTimers(existing)
      existing.doc.destroy()
    }
    const item = await this.prisma.driveItem.findFirst({
      where: {
        id: access.itemId,
        userId: access.ownerId,
        type: DRIVE_ITEM_TYPE.file,
        deletedAt: null,
        storageStatus: DRIVE_STORAGE_STATUS.active,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
      },
    })
    if (!item?.storageKey || !item.name.toLowerCase().endsWith(".md")) throw new BadRequestException("该文件不支持实时协同。")
    const version = await this.prisma.driveFileVersion.findFirst({
      where: { itemId: item.id, storageKey: item.storageKey, deletedAt: null },
    })
    if (!version) throw new BadRequestException("文件版本不存在。")
    await this.ensureDocument(item.id, version.id)
    const document = await this.prisma.driveCollaborationDocument.findUniqueOrThrow({ where: { itemId: item.id } })
    const doc = new Y.Doc()
    const checkpointObject = await this.storage.getObjectStream({ key: version.storageKey })
    const checkpointSource = await readStreamBuffer(checkpointObject.stream, DRIVE_MAX_FILE_BYTES)
    if (document.snapshotStorageKey) {
      const snapshotObject = await this.storage.getObjectStream({ key: document.snapshotStorageKey })
      const snapshot = await readStreamBuffer(snapshotObject.stream, objectReadMaxBytes)
      if (document.snapshotSha256 && sha256(snapshot) !== document.snapshotSha256) throw new Error("collaboration_snapshot_hash_mismatch")
      Y.applyUpdate(doc, snapshot, initializationOrigin)
    } else {
      doc.getText("content").insert(0, checkpointSource.toString("utf8"))
    }
    const segments = await this.prisma.driveCollaborationSegment.findMany({
      where: { itemId: item.id, epoch: document.epoch, deletePending: false },
      orderBy: { sequenceStart: "asc" },
    })
    for (const segment of segments) {
      const object = await this.storage.getObjectStream({ key: segment.storageKey })
      const update = await readStreamBuffer(object.stream, persistenceBatchMaxBytes * 4)
      if (sha256(update) !== segment.sha256) throw new Error("collaboration_segment_hash_mismatch")
      Y.applyUpdate(doc, update, initializationOrigin)
    }
    const currentSource = doc.getText("content").toString()
    const checkpointProjection = await this.projections.load(version.id)
    const currentProjection = await renderDriveMarkdownFragment(currentSource, {
      allowStandaloneRawImages: isPlainDriveMarkdownName(item.name),
      previousProjection: checkpointProjection
        ? { source: checkpointSource.toString("utf8"), projection: checkpointProjection }
        : null,
    })
    const awareness = new Awareness(doc)
    awareness.setLocalState(null)
    const room: CollaborationRoom = {
      itemId: item.id,
      ownerId: item.userId,
      itemName: item.name,
      mimeType: item.mimeType,
      doc,
      text: doc.getText("content"),
      awareness,
      connections: new Map(),
      contributors: new Map(),
      projectionState: {
        source: currentSource,
        html: currentProjection.html,
        outline: currentProjection.outline,
        projection: currentProjection.projection,
      },
      epoch: document.epoch,
      checkpointVersionId: document.checkpointVersionId,
      durableSequence: document.durableSequence,
      checkpointSequence: document.checkpointSequence,
      reservedBytes: document.reservedBytes,
      pending: [],
      pendingBytes: 0,
      flushTimer: null,
      flushPromise: null,
      idleCheckpointTimer: null,
      maxCheckpointTimer: null,
      leaveCheckpointTimer: null,
      previewTimer: null,
      dirtySince: null,
      acceptingWrites: true,
    }
    this.rooms.set(item.id, room)
    return room
  }

  private schedulePersistence(room: CollaborationRoom, options?: { readonly retry?: boolean }): void {
    if (!options?.retry && room.pendingBytes >= persistenceBatchMaxBytes) {
      if (room.flushTimer) clearTimeout(room.flushTimer)
      room.flushTimer = null
      void this.flushRoom(room).catch((error: unknown) => {
        this.logRoomFailure(room, "Drive collaboration persistence failed", error)
      })
      return
    }
    if (room.flushTimer) return
    room.flushTimer = setTimeout(() => {
      room.flushTimer = null
      void this.flushRoom(room).catch((error: unknown) => {
        this.logRoomFailure(room, "Drive collaboration persistence failed", error)
      })
    }, options?.retry ? persistenceRetryDelayMs : persistenceBatchDelayMs)
    room.flushTimer.unref?.()
  }

  private async flushRoom(room: CollaborationRoom): Promise<void> {
    if (room.flushPromise) return room.flushPromise
    if (room.flushTimer) {
      clearTimeout(room.flushTimer)
      room.flushTimer = null
    }
    if (room.pending.length === 0) return
    const batch = room.pending.splice(0)
    room.pendingBytes = 0
    room.flushPromise = this.persistBatch(room, batch).finally(() => {
      room.flushPromise = null
      if (room.pending.length > 0) this.schedulePersistence(room)
    })
    return room.flushPromise
  }

  private async persistBatch(room: CollaborationRoom, batch: readonly PendingUpdate[]): Promise<void> {
    const writers = [...new Set(batch.map((entry) => entry.connection))]
    const permissions = await Promise.all(writers.map(async (connection) => ({ connection, allowed: await connection.revalidate() })))
    const denied = permissions.find((entry) => !entry.allowed)
    if (denied) {
      denied.connection.sendControl({ type: "permission_changed", canWrite: false, reason: "permission_revoked" })
      denied.connection.close(1008, "permission_revoked")
      this.rooms.delete(room.itemId)
      room.doc.destroy()
      throw new ConflictException("编辑权限已变化。")
    }
    const merged = Buffer.from(Y.mergeUpdates(batch.map((entry) => entry.update)))
    const sequence = room.durableSequence + 1n
    const storageKey = collaborationSegmentKey(room.itemId, room.epoch, sequence, sequence)
    try {
      await this.storage.putObject({ key: storageKey, body: merged, contentType: "application/octet-stream" })
    } catch (error) {
      room.pending = [...batch, ...room.pending]
      room.pendingBytes += batch.reduce((total, entry) => total + entry.update.byteLength, 0)
      this.schedulePersistence(room, { retry: true })
      throw error
    }
    const bodySize = BigInt(Buffer.byteLength(room.text.toString(), "utf8"))
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockDriveItem(tx, room.itemId)
        const document = await tx.driveCollaborationDocument.findUnique({ where: { itemId: room.itemId } })
        if (!document || document.epoch !== room.epoch || document.durableSequence !== room.durableSequence) {
          throw new ConflictException("协同代际已变化。")
        }
        const reservationDelta = bodySize - document.reservedBytes
        if (reservationDelta > 0n) await reserveDriveUsageBytes(tx, room.ownerId, reservationDelta)
        if (reservationDelta < 0n) await releaseDriveUsageReservation(tx, room.ownerId, -reservationDelta)
        await tx.driveCollaborationSegment.create({
          data: {
            itemId: room.itemId,
            epoch: room.epoch,
            sequenceStart: sequence,
            sequenceEnd: sequence,
            storageKey,
            size: BigInt(merged.byteLength),
            sha256: sha256(merged),
          },
        })
        await tx.driveCollaborationDocument.update({
          where: { itemId: room.itemId },
          data: { durableSequence: sequence, reservedBytes: bodySize },
        })
      })
    } catch (error) {
      await this.deleteObjectAfterFailure(room, storageKey, "Drive collaboration segment object cleanup failed")
      for (const connection of room.connections.values()) {
        connection.sendControl({ type: "permission_changed", canWrite: false, reason: "durability_failed" })
        connection.close(1011, "durability_failed")
      }
      this.rooms.delete(room.itemId)
      room.doc.destroy()
      throw error
    }

    room.durableSequence = sequence
    room.reservedBytes = bodySize
    for (const entry of batch) {
      if (entry.connection.userId) {
        const current = room.contributors.get(entry.connection.userId)
        room.contributors.set(entry.connection.userId, {
          start: current?.start ?? sequence,
          end: sequence,
        })
      }
      entry.connection.sendControl({
        type: "durable_ack",
        epoch: room.epoch,
        sequence: sequence.toString(),
        updateId: entry.updateId,
      })
    }
    for (const connection of room.connections.values()) connection.sendUpdate(merged)
    this.schedulePreview(room)
    this.scheduleIdleCheckpoint(room)
  }

  private schedulePreview(room: CollaborationRoom): void {
    if (room.previewTimer) clearTimeout(room.previewTimer)
    room.previewTimer = setTimeout(() => {
      room.previewTimer = null
      const source = room.text.toString()
      void renderDriveMarkdownFragment(source, {
        allowStandaloneRawImages: isPlainDriveMarkdownName(room.itemName),
        previousProjection: room.projectionState,
      }).then((rendered) => {
        room.projectionState = {
          source,
          html: rendered.html,
          outline: rendered.outline,
          projection: rendered.projection,
        }
        this.bus.publish(room.itemId, {
          type: "preview.changed",
          itemId: room.itemId,
          epoch: room.epoch,
          stateVector: Buffer.from(Y.encodeStateVector(room.doc)).toString("base64"),
          html: rendered.html,
          outline: rendered.outline,
          projection: rendered.projection,
        })
      }).catch((error: unknown) => this.logRoomFailure(room, "Drive collaboration preview render failed", error))
    }, previewDelayMs)
    room.previewTimer.unref?.()
  }

  private scheduleIdleCheckpoint(room: CollaborationRoom): void {
    if (room.idleCheckpointTimer) clearTimeout(room.idleCheckpointTimer)
    room.idleCheckpointTimer = setTimeout(() => {
      room.idleCheckpointTimer = null
      void this.checkpoint(room.itemId, "idle").catch((error: unknown) => this.logRoomFailure(room, "Drive collaboration idle checkpoint failed", error))
    }, idleCheckpointDelayMs)
    room.idleCheckpointTimer.unref?.()
  }

  private scheduleMaxCheckpoint(room: CollaborationRoom): void {
    if (room.maxCheckpointTimer) return
    room.maxCheckpointTimer = setTimeout(() => {
      room.maxCheckpointTimer = null
      void this.checkpoint(room.itemId, "max_interval").catch((error: unknown) => this.logRoomFailure(room, "Drive collaboration max checkpoint failed", error))
    }, maxCheckpointDelayMs)
    room.maxCheckpointTimer.unref?.()
  }

  private resetCheckpointTimers(room: CollaborationRoom): void {
    room.dirtySince = null
    if (room.idleCheckpointTimer) clearTimeout(room.idleCheckpointTimer)
    if (room.maxCheckpointTimer) clearTimeout(room.maxCheckpointTimer)
    room.idleCheckpointTimer = null
    room.maxCheckpointTimer = null
  }

  private async compactSegments(room: CollaborationRoom): Promise<void> {
    const segments = await this.prisma.driveCollaborationSegment.findMany({
      where: { itemId: room.itemId, epoch: room.epoch, sequenceEnd: { lte: room.checkpointSequence } },
    })
    for (const segment of segments) {
      try {
        await this.storage.deleteObject(segment.storageKey)
        await this.prisma.driveCollaborationSegment.delete({ where: { id: segment.id } })
      } catch (error) {
        await this.prisma.driveCollaborationSegment.updateMany({ where: { id: segment.id }, data: { deletePending: true } })
        this.logRoomFailure(room, "Drive collaboration segment cleanup failed", error)
      }
    }
  }

  private clearRoomTimers(room: CollaborationRoom): void {
    for (const timer of [room.flushTimer, room.idleCheckpointTimer, room.maxCheckpointTimer, room.leaveCheckpointTimer, room.previewTimer]) {
      if (timer) clearTimeout(timer)
    }
  }

  private logRoomFailure(room: CollaborationRoom, message: string, error: unknown): void {
    this.logger.warn({
      epoch: room.epoch,
      errorMessage: error instanceof Error ? error.message : undefined,
      errorName: error instanceof Error ? error.name : typeof error,
      itemId: room.itemId,
    }, message)
  }

  private logExternalChangeFailure(itemId: string, epoch: string, message: string, error: unknown): void {
    this.logger.warn({
      epoch,
      errorMessage: error instanceof Error ? error.message : undefined,
      errorName: error instanceof Error ? error.name : typeof error,
      itemId,
    }, message)
  }

  private async deleteObjectAfterFailure(room: CollaborationRoom, storageKey: string, message: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey)
    } catch (error) {
      this.logger.warn({
        epoch: room.epoch,
        errorMessage: error instanceof Error ? error.message : undefined,
        errorName: error instanceof Error ? error.name : typeof error,
        itemId: room.itemId,
        storageKeyLength: storageKey.length,
      }, message)
    }
  }
}

function createEpoch(): string {
  return `epoch_${randomUUID().replace(/-/gu, "")}`
}

function collaborationSnapshotKey(itemId: string, epoch: string): string {
  return `drive/${itemId}/collaboration/${epoch}/snapshot.bin`
}

function collaborationSegmentKey(itemId: string, epoch: string, start: bigint, end: bigint): string {
  return `drive/${itemId}/collaboration/${epoch}/segments/${start.toString()}-${end.toString()}.bin`
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("drive_collaboration_shutdown_timeout")), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function lockDriveItem(tx: Prisma.TransactionClient, itemId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${itemId}, 0))::text AS "lock"`
}

async function readStreamBuffer(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) throw new BadRequestException("协同数据过大。")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
