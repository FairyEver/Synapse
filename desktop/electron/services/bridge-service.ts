import { timingSafeEqual } from "node:crypto"
import type { NetworkServiceDescriptor } from "../runtime/network"
import type { SynapseInboundMessage } from "../../src/types/connector"
import { normalizeInboundMessage } from "./inbound-message-normalizer"

export type BridgeAdapterStatus = "connected" | "disconnected"

export type BridgeAdapterRegistration = {
  platform: string
  capabilities?: string[]
  project?: string
  metadata?: Record<string, unknown>
}

export type BridgeAdapterSnapshot = {
  platform: string
  capabilities: string[]
  metadata: Record<string, unknown>
  status: BridgeAdapterStatus
  connectedAt: string
}

export type BridgeRegisterResult =
  | { ok: true; type: "register_ack"; adapter: BridgeAdapterSnapshot; capabilitiesSnapshot?: BridgeCapabilitiesSnapshot }
  | { ok: false; type: "register_ack"; error: string }

export type BridgeReplyContext = {
  platform: string
  sessionKey: string
  replyContext: string
  progressStyle: "legacy" | "compact" | "card"
  supportsProgressCardPayload: boolean
}

export type BridgeInboundResult =
  | { ok: true; message: SynapseInboundMessage; replyContext: BridgeReplyContext }
  | { ok: false; error: string }

export type BridgeCardActionResult =
  | { ok: true; dispatch: "message"; content: string; sessionKey: string; replyContext: BridgeReplyContext }
  | { ok: true; dispatch: "navigation"; action: string; sessionKey: string; replyContext: BridgeReplyContext }
  | { ok: false; error: string }

export type BridgeSession = {
  id: string
  sessionKey: string
  name: string
  active: boolean
  historyCount: number
}

export type BridgeCapabilitiesSnapshot = {
  type: "capabilities_snapshot"
  v: 1
  host: {
    synapseVersion: string
  }
  projects: Array<{
    project: string
    commands: BridgePublishedCommand[]
  }>
}

export type BridgePublishedCommand = {
  name: string
  description: string
  source: "builtin" | "custom"
  argsMode: "text"
}

export type BridgeServiceOptions = {
  port?: number
  path?: string
  tokenSecretRef?: string
  tokenValue?: string
  bindAddress?: string
  now?: () => Date
}

type BridgeAdapterState = BridgeAdapterSnapshot

function normalizePath(path: string | undefined): string {
  const trimmed = path?.trim()
  if (!trimmed) {
    return "/bridge/ws"
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  if (left.length !== right.length) {
    return false
  }

  return timingSafeEqual(left, right)
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function metadataIncludes(metadata: Record<string, unknown>, key: string, item: string): boolean {
  const value = metadata[key]
  if (Array.isArray(value)) {
    return value.some((entry) => entry === item)
  }

  return false
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  return cleanString(metadata[key])
}

function metadataBoolean(metadata: Record<string, unknown>, key: string): boolean | undefined {
  return typeof metadata[key] === "boolean" ? metadata[key] : undefined
}

function normalizeProgressStyle(value: string | undefined): "legacy" | "compact" | "card" {
  if (value === "compact" || value === "card") {
    return value
  }

  return "legacy"
}

function transportChatId(sessionKey: string): string | null {
  const parts = sessionKey.split(":")
  return parts.length >= 2 && parts[1] ? parts[1] : null
}

export class BridgeService {
  readonly port: number
  readonly path: string
  readonly tokenSecretRef: string | null
  readonly bindAddress: string
  private readonly tokenValue: string
  private readonly now: () => Date
  private readonly adapters = new Map<string, BridgeAdapterState>()
  private readonly sessions = new Map<string, BridgeSession[]>()
  private readonly publishedCommands = new Map<string, BridgePublishedCommand[]>()

  constructor(options: BridgeServiceOptions = {}) {
    this.port = options.port && options.port > 0 ? options.port : 9810
    this.path = normalizePath(options.path)
    this.tokenSecretRef = options.tokenSecretRef ?? null
    this.bindAddress = options.bindAddress ?? "127.0.0.1"
    this.tokenValue = options.tokenValue ?? ""
    this.now = options.now ?? (() => new Date())
  }

  authenticate(input: { authorization?: string; bridgeToken?: string; queryToken?: string } = {}): boolean {
    if (!this.tokenValue) {
      return true
    }

    if (input.authorization?.startsWith("Bearer ")) {
      return constantTimeEquals(input.authorization.slice("Bearer ".length), this.tokenValue)
    }

    return Boolean(
      (input.bridgeToken && constantTimeEquals(input.bridgeToken, this.tokenValue))
        || (input.queryToken && constantTimeEquals(input.queryToken, this.tokenValue)),
    )
  }

  registerAdapter(input: BridgeAdapterRegistration): BridgeRegisterResult {
    const platform = cleanString(input.platform)
    if (!platform) {
      return { ok: false, type: "register_ack", error: "platform name is required" }
    }

    const capabilities = Array.from(new Set([...(input.capabilities ?? []), "text"].map((item) => item.trim()).filter(Boolean))).sort()
    const metadata = input.metadata ?? {}
    const adapter: BridgeAdapterState = {
      platform,
      capabilities,
      metadata,
      status: "connected",
      connectedAt: this.now().toISOString(),
    }

    this.adapters.set(platform, adapter)

    return {
      ok: true,
      type: "register_ack",
      adapter: { ...adapter, capabilities: [...adapter.capabilities], metadata: { ...adapter.metadata } },
      ...(metadataIncludes(metadata, "control_plane", "capabilities_snapshot.v1")
        ? { capabilitiesSnapshot: this.buildCapabilitiesSnapshot() }
        : undefined),
    }
  }

  disconnectAdapter(platform: string): void {
    this.adapters.delete(platform)
  }

  listAdapters(): BridgeAdapterSnapshot[] {
    return Array.from(this.adapters.values()).map((adapter) => ({
      ...adapter,
      capabilities: [...adapter.capabilities],
      metadata: { ...adapter.metadata },
    }))
  }

  handleAdapterMessage(platform: string, raw: unknown, project?: string): BridgeInboundResult {
    const adapter = this.adapters.get(platform)
    if (!adapter) {
      return { ok: false, error: `adapter ${JSON.stringify(platform)} is not connected` }
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "message payload must be an object" }
    }

    const record = raw as Record<string, unknown>
    const sessionKey = cleanString(record.session_key)
    const userId = cleanString(record.user_id)
    if (!sessionKey || !userId) {
      return { ok: false, error: "session_key and user_id are required" }
    }

    const normalized = normalizeInboundMessage({
      platform,
      sessionKey,
      messageId: cleanString(record.msg_id),
      userId,
      userName: cleanString(record.user_name),
      content: cleanString(record.content) ?? "",
      images: record.images,
      files: record.files,
      audio: record.audio,
      replyContext: record.reply_ctx,
    }, {
      platform,
      connectorId: `connector:bridge:${platform}`,
      now: this.now,
    })

    if (!normalized.ok) {
      return { ok: false, error: normalized.message }
    }

    this.ensureSession(sessionKey, project)

    return {
      ok: true,
      message: normalized.message,
      replyContext: this.replyContextFor(adapter, sessionKey, cleanString(record.reply_ctx) ?? sessionKey),
    }
  }

  handleCardAction(platform: string, raw: unknown): BridgeCardActionResult {
    const adapter = this.adapters.get(platform)
    if (!adapter) {
      return { ok: false, error: `adapter ${JSON.stringify(platform)} is not connected` }
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "card_action payload must be an object" }
    }

    const record = raw as Record<string, unknown>
    const sessionKey = cleanString(record.session_key)
    const action = cleanString(record.action)
    if (!sessionKey || !action) {
      return { ok: false, error: "session_key and action are required" }
    }

    const replyContext = this.replyContextFor(adapter, sessionKey, cleanString(record.reply_ctx) ?? sessionKey)

    if (action === "perm:allow") {
      return { ok: true, dispatch: "message", content: "allow", sessionKey, replyContext }
    }
    if (action === "perm:deny") {
      return { ok: true, dispatch: "message", content: "deny", sessionKey, replyContext }
    }
    if (action === "perm:allow_all") {
      return { ok: true, dispatch: "message", content: "allow all", sessionKey, replyContext }
    }
    if (action.startsWith("askq:")) {
      return { ok: true, dispatch: "message", content: action, sessionKey, replyContext }
    }
    if (action.startsWith("cmd:")) {
      return { ok: true, dispatch: "message", content: action.slice("cmd:".length), sessionKey, replyContext }
    }

    return { ok: true, dispatch: "navigation", action, sessionKey, replyContext }
  }

  reconstructReplyContext(project: string, sessionKey: string): BridgeReplyContext | BridgeRejectedReplyContext {
    const platform = sessionKey.split(":")[0] ?? ""
    const adapter = this.adapters.get(platform)
    if (!adapter) {
      return { ok: false, error: `adapter ${JSON.stringify(platform)} not connected` }
    }

    if (!adapter.capabilities.includes("reconstruct_reply")) {
      return { ok: false, error: `adapter ${JSON.stringify(platform)} does not support reconstruct_reply` }
    }

    const chatId = transportChatId(sessionKey)
    if (!chatId) {
      return { ok: false, error: `invalid session key ${JSON.stringify(sessionKey)}` }
    }

    const payload = JSON.stringify({
      kind: "bridge_reconstruct",
      v: 1,
      sender_project: project,
      transport_chat_id: chatId,
      transport_session_key: sessionKey,
    })

    return this.replyContextFor(adapter, sessionKey, payload)
  }

  createSession(sessionKey: string, name = "default"): BridgeSession {
    const existing = this.sessions.get(sessionKey) ?? []
    const session: BridgeSession = {
      id: `bridge-session-${existing.length + 1}`,
      sessionKey,
      name: name.trim() || "default",
      active: true,
      historyCount: 0,
    }
    const next = existing.map((item) => ({ ...item, active: false }))
    next.push(session)
    this.sessions.set(sessionKey, next)
    return { ...session }
  }

  listSessions(sessionKey: string): BridgeSession[] {
    return (this.sessions.get(sessionKey) ?? []).map((session) => ({ ...session }))
  }

  switchSession(sessionKey: string, target: string): BridgeSession | null {
    const sessions = this.sessions.get(sessionKey) ?? []
    const exists = sessions.some((session) => session.id === target || session.name === target)
    if (!exists) {
      return null
    }

    const next = sessions.map((session) => ({
      ...session,
      active: session.id === target || session.name === target,
    }))
    this.sessions.set(sessionKey, next)
    return next.find((session) => session.active) ?? null
  }

  deleteSession(sessionKey: string, id: string): boolean {
    const sessions = this.sessions.get(sessionKey) ?? []
    const next = sessions.filter((session) => session.id !== id)
    if (next.length === sessions.length) {
      return false
    }
    this.sessions.set(sessionKey, next)
    return true
  }

  setPublishedCommands(project: string, commands: BridgePublishedCommand[]): void {
    this.publishedCommands.set(project, commands.map((command) => ({ ...command })))
  }

  buildCapabilitiesSnapshot(): BridgeCapabilitiesSnapshot {
    const projects = Array.from(this.publishedCommands.entries()).map(([project, commands]) => ({
      project,
      commands: commands.map((command) => ({ ...command })),
    }))

    return {
      type: "capabilities_snapshot",
      v: 1,
      host: { synapseVersion: "3s" },
      projects,
    }
  }

  createNetworkDescriptor(): NetworkServiceDescriptor {
    return {
      id: "connectors.bridge",
      role: "websocket",
      preferredPort: this.port,
      bindAddress: this.bindAddress,
      auth: this.tokenSecretRef
        ? { kind: "bearer", tokenSecretRef: this.tokenSecretRef }
        : { kind: "none" },
      handler: {
        handle: (request) => request,
      },
    }
  }

  private ensureSession(sessionKey: string, project: string | undefined): void {
    if (!this.sessions.has(sessionKey)) {
      this.createSession(sessionKey, project || "default")
    }
  }

  private replyContextFor(adapter: BridgeAdapterState, sessionKey: string, replyContext: string): BridgeReplyContext {
    return {
      platform: adapter.platform,
      sessionKey,
      replyContext,
      progressStyle: this.progressStyleFor(adapter),
      supportsProgressCardPayload: this.supportsProgressCardPayload(adapter),
    }
  }

  private progressStyleFor(adapter: BridgeAdapterState): "legacy" | "compact" | "card" {
    const explicit = normalizeProgressStyle(metadataString(adapter.metadata, "progress_style"))
    if (explicit !== "legacy") {
      return explicit
    }

    if (adapter.capabilities.includes("preview") && adapter.capabilities.includes("update_message")) {
      return adapter.capabilities.includes("card") ? "card" : "compact"
    }

    return "legacy"
  }

  private supportsProgressCardPayload(adapter: BridgeAdapterState): boolean {
    const explicit = metadataBoolean(adapter.metadata, "supports_progress_card_payload")
    if (explicit !== undefined) {
      return explicit
    }

    return metadataString(adapter.metadata, "adapter") === "bot-gateway"
      && adapter.capabilities.includes("preview")
      && adapter.capabilities.includes("update_message")
  }
}

type BridgeRejectedReplyContext = {
  ok: false
  error: string
}

export function bridgeCapabilitiesFromWire(value: unknown): string[] {
  return Array.from(new Set([...readStringList(value), "text"])).sort()
}
