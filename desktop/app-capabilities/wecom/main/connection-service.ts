import { createHash } from "node:crypto"
import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type {
  WecomConnectionBindingV1,
  WecomConnectionStateV1,
  WecomMailBindingV1,
  WecomMailStateV1,
} from "../../../electron/runtime/data-repo/schemas/connectors"
import type { SynapseAccountState } from "../../../src/types/account"
import {
  WECOM_CONNECTOR_ID,
  WECOM_LEGACY_CONNECTOR_ID,
} from "../shared/capability"
import { WecomCliError, type WecomCliAuthSession, type WecomCliClient } from "./cli-client"

export type WecomConnectionStatus =
  | "disconnected"
  | "connecting"
  | "verifying"
  | "connected"
  | "reconnect_required"
  | "failed"

export type WecomConnectionSnapshot = {
  readonly status: WecomConnectionStatus
  readonly enabled: boolean
  readonly qrCodeDataUrl?: string
  readonly errorMessage?: string
  readonly connectedAt?: string
  readonly lastValidatedAt?: string
}

export type WecomConnectionServiceDeps = {
  readonly state: DataNamespace<WecomConnectionStateV1>
  readonly legacyState: DataNamespace<WecomMailStateV1>
  readonly account: {
    getState(): SynapseAccountState
    onBeforeIdentityChange(listener: () => void | Promise<void>): () => void
    onStateChanged(listener: (state: SynapseAccountState) => void): () => void
  }
  readonly client: WecomCliClient
  readonly now?: () => number
}

type Attempt = {
  readonly ownerUserId: string
  status: WecomConnectionStatus
  session?: WecomCliAuthSession
  qrCodeDataUrl?: string
  errorMessage?: string
}

export class WecomConnectionService {
  private readonly attempts = new Map<string, Attempt>()
  private readonly activeOperations = new Set<AbortController>()
  private readonly activeOwners = new Set<string>()
  private readonly restoring = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private unsubscribe: Array<() => void> = []
  private restoredOwner: string | null = null
  private generation = 0
  private readonly now: () => number

  constructor(private readonly deps: WecomConnectionServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  initialize(): void {
    if (this.unsubscribe.length > 0) return
    this.unsubscribe = [
      this.deps.account.onBeforeIdentityChange(() => this.invalidate()),
      this.deps.account.onStateChanged(() => {
        if (this.ownerUserId() !== this.restoredOwner) this.invalidate()
        else this.notify()
      }),
    ]
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    this.unsubscribe = []
    this.invalidate()
    this.listeners.clear()
  }

  async snapshot(): Promise<WecomConnectionSnapshot> {
    const owner = this.ownerUserId()
    if (!owner) return { status: "disconnected", enabled: false }
    const binding = await this.readBinding(owner)
    const attempt = this.attempts.get(owner)
    if (!attempt && binding?.enabled) void this.restore(owner)
    const status = attempt?.status ?? (binding?.enabled ? "connected" : "disconnected")
    return {
      status,
      enabled: ["connecting", "verifying", "connected"].includes(status),
      ...(attempt?.qrCodeDataUrl ? { qrCodeDataUrl: attempt.qrCodeDataUrl } : {}),
      ...(attempt?.errorMessage ? { errorMessage: attempt.errorMessage } : {}),
      ...(binding ? { connectedAt: binding.connectedAt, lastValidatedAt: binding.lastValidatedAt } : {}),
    }
  }

  async connect(): Promise<WecomConnectionSnapshot> {
    const owner = this.requireOwner()
    const generation = this.generation
    this.restoredOwner = owner
    const previous = this.attempts.get(owner)
    if (previous?.session) {
      const session = previous.session
      previous.session = undefined
      await session.cancel()
    }
    this.cancelAttempt(previous)

    let authorized = true
    try {
      await this.deps.client.validate(owner)
    } catch (error) {
      if (!isAuthError(error)) {
        this.attempts.set(owner, {
          ownerUserId: owner,
          status: "failed",
          errorMessage: errorMessage(error),
        })
        this.notify()
        throw error
      }
      authorized = false
    }
    this.assertCurrent(owner, generation)

    if (authorized) {
      const binding = await this.readBinding(owner)
      this.assertCurrent(owner, generation)
      const attempt: Attempt = { ownerUserId: owner, status: "verifying" }
      this.attempts.set(owner, attempt)
      this.notify()
      await this.writeBinding(owner, true, binding)
      this.assertCurrent(owner, generation)
      attempt.status = "connected"
      this.notify()
      return this.snapshot()
    }

    await this.removeBinding(owner)
    this.assertCurrent(owner, generation)
    const attempt: Attempt = { ownerUserId: owner, status: "connecting" }
    this.attempts.set(owner, attempt)
    this.notify()

    try {
      const session = await this.deps.client.startAuth(owner)
      attempt.session = session
      attempt.qrCodeDataUrl = session.qrCodeDataUrl
      this.notify()
      void session.wait()
        .then(async () => {
          if (this.attempts.get(owner) !== attempt) return
          attempt.status = "verifying"
          attempt.qrCodeDataUrl = undefined
          this.notify()
          await this.deps.client.validate(owner)
          if (this.attempts.get(owner) !== attempt) return
          await this.writeBinding(owner, true)
          attempt.status = "connected"
          attempt.session = undefined
          this.notify()
        })
        .catch((error: unknown) => {
          if (this.attempts.get(owner) !== attempt) return
          attempt.status = isAuthError(error) ? "reconnect_required" : "failed"
          attempt.errorMessage = errorMessage(error)
          attempt.session = undefined
          attempt.qrCodeDataUrl = undefined
          this.notify()
        })
    } catch (error) {
      attempt.status = "failed"
      attempt.errorMessage = errorMessage(error)
      attempt.session = undefined
      attempt.qrCodeDataUrl = undefined
      this.notify()
      throw error
    }

    return this.snapshot()
  }

  async disconnect(): Promise<void> {
    const owner = this.ownerUserId()
    if (!owner) return
    const attempt = this.attempts.get(owner)
    if (attempt?.session) {
      const session = attempt.session
      attempt.session = undefined
      await session.cancel()
    }
    this.cancelAttempt(attempt)
    this.attempts.delete(owner)
    await this.deps.client.disconnect(owner)
    await this.removeBinding(owner)
    this.notify()
  }

  async withConnected<T>(operation: (context: {
    readonly ownerUserId: string
    readonly client: WecomCliClient
    readonly signal: AbortSignal
  }) => Promise<T>): Promise<T> {
    const owner = this.requireOwner()
    const generation = this.generation
    await this.ensureConnected(owner, generation)
    this.assertCurrent(owner, generation)
    const controller = new AbortController()
    this.activeOperations.add(controller)
    this.activeOwners.add(owner)
    try {
      return await operation({ ownerUserId: owner, client: this.deps.client, signal: controller.signal })
    } catch (error) {
      if (isAuthError(error)) {
        const attempt = this.attempts.get(owner)
        if (attempt) {
          attempt.status = "reconnect_required"
          attempt.errorMessage = errorMessage(error)
          this.notify()
        }
      }
      throw error
    } finally {
      this.activeOperations.delete(controller)
      this.activeOwners.delete(owner)
    }
  }

  private ownerUserId(): string | null {
    const state = this.deps.account.getState()
    return state.status === "authenticated" && state.profile.user.status === "active"
      ? state.profile.user.id
      : null
  }

  private requireOwner(): string {
    const owner = this.ownerUserId()
    if (!owner) throw new WecomCliError("auth_required", "请先登录 Synapse。")
    return owner
  }

  private async ensureConnected(owner: string, generation: number): Promise<void> {
    this.assertCurrent(owner, generation)
    const current = this.attempts.get(owner)
    if (current?.status === "connected") return
    const binding = await this.readBinding(owner)
    this.assertCurrent(owner, generation)
    if (!binding?.enabled) {
      throw new WecomCliError("connector_required", "请先在连接器中连接企业微信。")
    }
    try {
      await this.deps.client.validate(owner)
      this.assertCurrent(owner, generation)
    } catch (error) {
      this.attempts.set(owner, {
        ownerUserId: owner,
        status: isAuthError(error) ? "reconnect_required" : "failed",
        errorMessage: errorMessage(error),
      })
      this.notify()
      throw error instanceof WecomCliError
        ? error
        : new WecomCliError("auth_required", "企业微信授权已失效，请重新连接。")
    }
    this.attempts.set(owner, { ownerUserId: owner, status: "connected" })
    await this.touchBinding(owner, binding)
    this.assertCurrent(owner, generation)
  }

  private async restore(owner: string): Promise<void> {
    if (this.restoring.has(owner) || this.attempts.has(owner)) return
    this.restoring.add(owner)
    this.restoredOwner = owner
    const generation = this.generation
    try {
      const binding = await this.readBinding(owner)
      this.assertCurrent(owner, generation)
      if (!binding?.enabled) return
      const attempt: Attempt = { ownerUserId: owner, status: "verifying" }
      this.attempts.set(owner, attempt)
      this.notify()
      try {
        await this.deps.client.validate(owner)
        this.assertCurrent(owner, generation)
      } catch (error) {
        if (!isAuthError(error)) throw error
        attempt.status = "reconnect_required"
        attempt.errorMessage = errorMessage(error)
        this.notify()
        return
      }
      await this.touchBinding(owner, binding)
      if (this.attempts.get(owner) !== attempt) return
      attempt.status = "connected"
      this.notify()
    } catch (error) {
      const attempt = this.attempts.get(owner)
      if (attempt) {
        attempt.status = isAuthError(error) ? "reconnect_required" : "failed"
        attempt.errorMessage = errorMessage(error)
        this.notify()
      }
    } finally {
      this.restoring.delete(owner)
    }
  }

  private cancelAttempt(attempt: Attempt | undefined): void {
    if (!attempt) return
    attempt.session?.cancel().catch(() => undefined)
    attempt.session = undefined
    attempt.qrCodeDataUrl = undefined
  }

  private invalidate(): void {
    this.generation += 1
    for (const attempt of this.attempts.values()) this.cancelAttempt(attempt)
    const ownersToClear = new Set([...this.attempts.keys(), ...this.activeOwners])
    this.attempts.clear()
    for (const controller of this.activeOperations) controller.abort()
    this.activeOperations.clear()
    this.activeOwners.clear()
    for (const owner of ownersToClear) {
      void this.deps.client.clearAgentWork(owner).catch(() => undefined)
    }
    this.restoredOwner = null
    this.notify()
  }

  private assertCurrent(owner: string, generation: number): void {
    if (this.generation !== generation || this.ownerUserId() !== owner) {
      throw new WecomCliError("cancelled", "企业微信账号已切换。")
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private key(owner: string): string {
    return createHash("sha256").update(`${owner}:${WECOM_CONNECTOR_ID}`).digest("hex")
  }

  private legacyKey(owner: string): string {
    return createHash("sha256").update(`${owner}:${WECOM_LEGACY_CONNECTOR_ID}`).digest("hex")
  }

  private async readBinding(owner: string): Promise<WecomConnectionBindingV1 | undefined> {
    const state = await this.deps.state.getSingleton()
    const binding = state?.bindings[this.key(owner)]
    if (binding) return binding
    return this.migrateLegacyBinding(owner)
  }

  private async migrateLegacyBinding(owner: string): Promise<WecomConnectionBindingV1 | undefined> {
    const legacy = await this.deps.legacyState.getSingleton()
    if (!legacy) return undefined
    const key = this.legacyKey(owner)
    const old = legacy.bindings[key] ?? Object.values(legacy.bindings).find((binding) => (
      binding.ownerUserId === owner && binding.connectorId === WECOM_LEGACY_CONNECTOR_ID
    ))
    if (!old) return undefined
    const binding = await this.writeBinding(owner, true, this.fromLegacy(old))
    const next = { ...legacy.bindings }
    delete next[key]
    for (const [candidateKey, candidate] of Object.entries(next)) {
      if (candidate.ownerUserId === owner && candidate.connectorId === WECOM_LEGACY_CONNECTOR_ID) {
        delete next[candidateKey]
      }
    }
    await this.deps.legacyState.setSingleton({ ...legacy, bindings: next })
    return binding
  }

  private fromLegacy(binding: WecomMailBindingV1): WecomConnectionBindingV1 {
    return {
      ownerUserId: binding.ownerUserId,
      connectorId: WECOM_CONNECTOR_ID,
      enabled: true,
      connectedAt: binding.connectedAt,
      lastValidatedAt: binding.lastValidatedAt,
    }
  }

  private async writeBinding(
    owner: string,
    enabled: boolean,
    existing?: WecomConnectionBindingV1,
  ): Promise<WecomConnectionBindingV1> {
    const state = await this.deps.state.getSingleton() ?? { schemaVersion: 1 as const, bindings: {} }
    const timestamp = new Date(this.now()).toISOString()
    const binding: WecomConnectionBindingV1 = {
      ownerUserId: owner,
      connectorId: WECOM_CONNECTOR_ID,
      enabled,
      connectedAt: existing?.connectedAt ?? timestamp,
      lastValidatedAt: timestamp,
    }
    await this.deps.state.setSingleton({
      ...state,
      bindings: { ...state.bindings, [this.key(owner)]: binding },
    })
    return binding
  }

  private async touchBinding(owner: string, binding: WecomConnectionBindingV1): Promise<void> {
    await this.writeBinding(owner, true, binding)
  }

  private async removeBinding(owner: string): Promise<void> {
    const state = await this.deps.state.getSingleton()
    if (state) {
      const next = { ...state.bindings }
      delete next[this.key(owner)]
      await this.deps.state.setSingleton({ ...state, bindings: next })
    }
    const legacy = await this.deps.legacyState.getSingleton()
    if (!legacy) return
    const next = { ...legacy.bindings }
    for (const [key, binding] of Object.entries(next)) {
      if (binding.ownerUserId === owner && binding.connectorId === WECOM_LEGACY_CONNECTOR_ID) delete next[key]
    }
    await this.deps.legacyState.setSingleton({ ...legacy, bindings: next })
  }
}

function isAuthError(error: unknown): boolean {
  return error instanceof WecomCliError && error.code === "auth_required"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "企业微信连接失败，请重试。"
}
