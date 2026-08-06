import type {
  DriveBrowserCollaborationCapabilityDto,
  DriveCollaborationControlMessage,
  DriveCollaborationJoinContext,
  DriveAnnotationCrdtRangeSelector,
  DriveAnnotationTextPositionSelector,
  DriveMarkdownOutlineItemDto,
  DriveMarkdownProjectionDto,
} from '@synapse/shared'
import { codePointCount, DRIVE_COLLABORATION_PROTOCOL_VERSION } from '@synapse/shared'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { Awareness } from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { IndexeddbPersistence } from 'y-indexeddb'

const messageSync = 0
const messageAwareness = 1
const maximumReconnectDelayMs = 10_000
const collaborationTabClientId = crypto.randomUUID()

export type DriveCollaborationStatus = 'connecting' | 'syncing' | 'synced' | 'failed' | 'readonly'

export type DriveCollaborationPreview = {
  readonly epoch: string
  readonly stateVector: string
  readonly html: string
  readonly outline: readonly DriveMarkdownOutlineItemDto[]
  readonly projection: DriveMarkdownProjectionDto
}

export type DriveCollaborationSnapshot = {
  readonly status: DriveCollaborationStatus
  readonly error: string | null
  readonly epoch: string | null
  readonly checkpointVersionId: string | null
  readonly canWrite: boolean
  readonly onlineCount: number
  readonly preview: DriveCollaborationPreview | null
  readonly annotationRevision: number
  readonly epochTransition: 'reload' | 'preserve_local' | null
}

export type DriveCollaborationSessionInput = {
  readonly itemId: string
  readonly context: DriveCollaborationJoinContext
  readonly capability: DriveBrowserCollaborationCapabilityDto
  readonly onEpochReloadRequired?: () => void
}

export class DriveCollaborationSession {
  readonly doc = new Y.Doc()
  readonly text = this.doc.getText('content')
  readonly awareness = new Awareness(this.doc)

  private readonly listeners = new Set<() => void>()
  private readonly clientId: string
  private readonly persistence: IndexeddbPersistence | null
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelayMs = 1_000
  private destroyed = false
  private joined = false
  private state: DriveCollaborationSnapshot

  constructor(private readonly input: DriveCollaborationSessionInput) {
    this.clientId = collaborationTabClientId
    this.state = {
      status: input.capability.canWrite ? 'connecting' : 'readonly',
      error: null,
      epoch: input.capability.epoch,
      checkpointVersionId: input.capability.checkpointVersionId,
      canWrite: input.capability.canWrite,
      onlineCount: 0,
      preview: null,
      annotationRevision: 0,
      epochTransition: null,
    }
    this.persistence = input.capability.canWrite && typeof indexedDB !== 'undefined'
      ? new IndexeddbPersistence(persistenceKey(input), this.doc)
      : null
    this.doc.on('update', this.handleDocumentUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
    this.awareness.on('change', this.handleAwarenessChange)
    if (input.capability.canWrite) {
      this.awareness.setLocalStateField('user', {
        name: `协作者 ${this.clientId.slice(0, 4)}`,
        color: 'var(--primary)',
        colorLight: 'var(--accent)',
      })
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): DriveCollaborationSnapshot => this.state

  resolveRelativeRange = (selector: DriveAnnotationCrdtRangeSelector): DriveAnnotationTextPositionSelector | null => {
    if (this.state.epoch !== selector.epoch) return null
    try {
      const start = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(base64ToBytes(selector.start)),
        this.doc,
      )
      const end = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(base64ToBytes(selector.end)),
        this.doc,
      )
      if (!start || !end || start.type !== this.text || end.type !== this.text || end.index < start.index) return null
      const source = this.text.toString()
      return {
        start: codePointCount(source.slice(0, start.index)),
        end: codePointCount(source.slice(0, end.index)),
      }
    } catch {
      return null
    }
  }

  connect = async (): Promise<void> => {
    if (this.destroyed || this.socket || !this.input.capability.enabled) return
    try {
      await this.persistence?.whenSynced
    } catch {
      this.setState({ status: 'failed', error: '无法读取本地协同副本。' })
      return
    }
    if (this.destroyed || this.socket) return
    this.setState({ status: this.input.capability.canWrite ? 'connecting' : 'readonly', error: null })
    const socket = new WebSocket(collaborationWebSocketUrl(this.input.capability.websocketPath))
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.addEventListener('open', () => this.handleOpen(socket))
    socket.addEventListener('message', (event) => this.handleMessage(socket, event.data))
    socket.addEventListener('error', () => this.handleSocketFailure(socket, '协同连接失败。'))
    socket.addEventListener('close', () => this.handleSocketClose(socket))
  }

  destroy = (): void => {
    if (this.destroyed) return
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.doc.off('update', this.handleDocumentUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.awareness.off('change', this.handleAwarenessChange)
    this.awareness.destroy()
    void this.persistence?.destroy()
    this.socket?.close(1000, 'client_closed')
    this.socket = null
    this.doc.destroy()
    this.listeners.clear()
  }

  private readonly handleOpen = (socket: WebSocket): void => {
    if (this.socket !== socket) return
    const stateVector = Y.encodeStateVector(this.doc)
    socket.send(JSON.stringify({
      type: 'join',
      protocolVersion: DRIVE_COLLABORATION_PROTOCOL_VERSION,
      clientId: this.clientId,
      context: this.input.context,
      epoch: this.state.epoch,
      stateVector: bytesToBase64(stateVector),
    }))
    this.setState({ status: this.state.canWrite ? 'syncing' : 'readonly', error: null })
  }

  private readonly handleMessage = (socket: WebSocket, payload: unknown): void => {
    if (this.socket !== socket) return
    if (typeof payload === 'string') {
      this.handleControl(parseControlMessage(payload))
      return
    }
    if (!(payload instanceof ArrayBuffer)) return
    const decoder = decoding.createDecoder(new Uint8Array(payload))
    const messageType = decoding.readVarUint(decoder)
    if (messageType === messageSync) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)
      if (this.state.canWrite && encoding.length(encoder) > 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(encoding.toUint8Array(encoder))
      }
      return
    }
    if (messageType === messageAwareness) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this)
    }
  }

  private handleControl(message: DriveCollaborationControlMessage | null): void {
    if (!message) return
    if (message.type === 'joined') {
      this.joined = true
      this.reconnectDelayMs = 1_000
      this.setState({
        epoch: message.epoch,
        checkpointVersionId: message.checkpointVersionId,
        canWrite: message.canWrite,
        status: message.canWrite ? 'syncing' : 'readonly',
        error: null,
      })
      this.sendSyncStep1()
      this.sendLocalAwareness()
      return
    }
    if (message.type === 'durable_ack') {
      if (message.epoch === this.state.epoch && this.state.canWrite) this.setState({ status: 'synced', error: null })
      return
    }
    if (message.type === 'checkpoint.changed') {
      if (message.epoch === this.state.epoch) this.setState({ checkpointVersionId: message.checkpointVersionId })
      return
    }
    if (message.type === 'preview.changed') {
      this.setState({ preview: { epoch: message.epoch, stateVector: message.stateVector, html: message.html, outline: message.outline, projection: message.projection } })
      return
    }
    if (message.type === 'annotation.changed') {
      this.setState({ annotationRevision: this.state.annotationRevision + 1 })
      return
    }
    if (message.type === 'permission_changed') {
      this.setState({
        canWrite: message.canWrite,
        status: message.canWrite ? 'synced' : 'readonly',
        error: message.canWrite
          ? null
          : message.reason === 'durability_failed'
            ? '同步未能可靠保存，本地副本已保留。'
            : '编辑权限已变化。',
      })
      return
    }
    if (message.type === 'epoch_replaced') {
      const canReload = !this.state.canWrite || this.state.status === 'synced'
      this.setState({
        canWrite: false,
        status: canReload ? 'connecting' : 'readonly',
        epoch: message.epoch,
        checkpointVersionId: message.checkpointVersionId,
        error: canReload ? null : '文件已切换到新的协同代际，本地副本已保留。',
        epochTransition: canReload ? 'reload' : 'preserve_local',
      })
      this.socket?.close(1000, 'epoch_replaced')
      if (canReload) this.input.onEpochReloadRequired?.()
      return
    }
    this.setState({ status: 'failed', error: message.message })
  }

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this || !this.state.canWrite) return
    const socket = this.socket
    if (!this.joined || !socket || socket.readyState !== WebSocket.OPEN) {
      this.setState({ status: 'syncing' })
      return
    }
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeUpdate(encoder, update)
    socket.send(encoding.toUint8Array(encoder))
    this.setState({ status: 'syncing', error: null })
  }

  private readonly handleAwarenessUpdate = ({ added, updated, removed }: {
    readonly added: readonly number[]
    readonly updated: readonly number[]
    readonly removed: readonly number[]
  }, origin: unknown): void => {
    if (origin === this || !this.state.canWrite) return
    this.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]))
  }

  private readonly handleAwarenessChange = (): void => {
    const onlineCount = [...this.awareness.getStates().values()].filter((value) => value.user).length
    this.setState({ onlineCount })
  }

  private sendSyncStep1(): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    socket.send(encoding.toUint8Array(encoder))
  }

  private sendLocalAwareness(): void {
    if (!this.state.canWrite) return
    this.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
  }

  private sendAwareness(update: Uint8Array): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(encoder, update)
    socket.send(encoding.toUint8Array(encoder))
  }

  private readonly handleSocketFailure = (socket: WebSocket, message: string): void => {
    if (this.socket !== socket) return
    this.setState({ status: 'failed', error: message })
  }

  private readonly handleSocketClose = (socket: WebSocket): void => {
    if (this.socket !== socket) return
    this.socket = null
    this.joined = false
    if (this.destroyed || !this.state.canWrite || this.state.error?.includes('协同代际')) return
    this.setState({ status: 'connecting' })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, this.reconnectDelayMs)
    this.reconnectDelayMs = Math.min(maximumReconnectDelayMs, this.reconnectDelayMs * 2)
  }

  private setState(patch: Partial<DriveCollaborationSnapshot>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function persistenceKey(input: DriveCollaborationSessionInput): string {
  const contextKey = input.context.kind === 'owner' ? 'owner' : `share:${input.context.shareId}`
  return `synapse-drive-collaboration:${contextKey}:${input.itemId}:${input.capability.epoch ?? input.capability.checkpointVersionId ?? 'initial'}`
}

function collaborationWebSocketUrl(path: string): string {
  const url = new URL(path, window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function bytesToBase64(value: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < value.byteLength; index += 1) binary += String.fromCharCode(value[index] ?? 0)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function parseControlMessage(value: string): DriveCollaborationControlMessage | null {
  try {
    const parsed = JSON.parse(value) as { readonly type?: unknown }
    return typeof parsed?.type === 'string' ? parsed as DriveCollaborationControlMessage : null
  } catch {
    return null
  }
}
