import type { CoreLicenseV1, DataNamespace } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import { getLicenseServerUrl, isDevLicenseServer } from "./constants"
import { createDeviceId, createDeviceMetadata, hashDeviceId } from "./device-id"
import { LicenseClient, LicenseClientRequestError, normalizeLicenseServerUrl } from "./license-client"
import { verifyLicenseLease } from "./license-token"
import { findPinnedKey } from "./pinned-keys"
import type {
  DesktopLicenseActivationRequest,
  DesktopLicenseStatus,
  LicenseLeasePayload,
} from "./types"

const RENEW_BEFORE_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000
const LICENSE_STATUS_CHECK_INTERVAL_MS = 60 * 1000
const MAX_BACKOFF_MS = 30 * 60 * 1000
const CONSECUTIVE_WARN_LIMIT = 3

export interface LicenseServiceDeps {
  readonly store: DataNamespace<CoreLicenseV1>
  readonly client: LicenseClient
  readonly appVersion: string
  readonly logger?: Pick<StructuredLogger, "warn" | "info">
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export class LicenseService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private renewTimer: NodeJS.Timeout | null = null
  private currentDelayMs = LICENSE_STATUS_CHECK_INTERVAL_MS
  private consecutiveFailures = 0

  constructor(private readonly deps: LicenseServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? createDeviceId
  }

  start(): void {
    if (this.renewTimer) return
    this.scheduleNext(0)
  }

  stop(): void {
    if (!this.renewTimer) return
    clearTimeout(this.renewTimer)
    this.renewTimer = null
  }

  async getStatus(): Promise<DesktopLicenseStatus> {
    const state = await this.ensureState()
    return this.statusFromState(state)
  }

  async activate(input: DesktopLicenseActivationRequest): Promise<DesktopLicenseStatus> {
    const state = await this.ensureState()
    const serverUrl = normalizeLicenseServerUrl(getLicenseServerUrl())
    const config = await this.deps.client.getConfig(serverUrl)
    const publicKey = this.resolvePublicKey(config.keyId, config.publicKey)
    const device = createDeviceMetadata(state.deviceId, this.deps.appVersion)
    const response = await this.deps.client.redeem(serverUrl, {
      email: input.email.trim().toLowerCase(),
      activationCode: input.activationCode,
      device,
    })
    const payload = verifyLeaseForDevice(response.leaseToken, publicKey, state.deviceId)
    const nextState: CoreLicenseV1 = {
      ...state,
      serverUrl,
      email: response.email,
      publicKey,
      keyId: config.keyId,
      leaseToken: response.leaseToken,
      leaseExpiresAt: payload.expiresAt,
      deviceIdHash: response.deviceIdHash,
      activatedAt: state.activatedAt ?? this.now().toISOString(),
      lastRenewedAt: this.now().toISOString(),
    }
    await this.deps.store.setSingleton(nextState)
    return this.statusFromState(nextState)
  }

  async renew(): Promise<DesktopLicenseStatus> {
    const state = await this.ensureState()
    if (!state.serverUrl || !state.leaseToken) {
      return this.statusFromState(state)
    }

    try {
      const nextState = await this.renewState(state)
      return this.statusFromState(nextState)
    } catch (error) {
      if (isTerminalLicenseServerError(error)) {
        return this.statusFromState(await this.clearLease(state))
      }
      throw error
    }
  }

  async resetActivation(): Promise<DesktopLicenseStatus> {
    const state = await this.ensureState()
    const nextState: CoreLicenseV1 = {
      ...state,
      deviceIdHash: null,
      serverUrl: null,
      email: null,
      publicKey: null,
      keyId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      activatedAt: null,
      lastRenewedAt: null,
    }
    await this.deps.store.setSingleton(nextState)
    return this.statusFromState(nextState)
  }

  private async renewState(state: CoreLicenseV1): Promise<CoreLicenseV1> {
    if (!state.serverUrl || !state.leaseToken) return state
    const config = await this.deps.client.getConfig(state.serverUrl)
    const publicKey = this.resolvePublicKey(config.keyId, config.publicKey)
    const response = await this.deps.client.renew(state.serverUrl, {
      leaseToken: state.leaseToken,
      device: createDeviceMetadata(state.deviceId, this.deps.appVersion),
    })
    const payload = verifyLeaseForDevice(response.leaseToken, publicKey, state.deviceId)
    const nextState: CoreLicenseV1 = {
      ...state,
      email: response.email,
      publicKey,
      keyId: config.keyId,
      leaseToken: response.leaseToken,
      leaseExpiresAt: payload.expiresAt,
      deviceIdHash: response.deviceIdHash,
      lastRenewedAt: this.now().toISOString(),
    }
    await this.deps.store.setSingleton(nextState)
    return nextState
  }

  private resolvePublicKey(keyId: string, serverPublicKey: string): string {
    if (isDevLicenseServer()) {
      return serverPublicKey
    }
    const pinned = findPinnedKey(keyId)
    if (!pinned) {
      throw new Error("不受信任的授权密钥。")
    }
    return pinned.publicKey
  }

  private async syncWithServer(): Promise<void> {
    const state = await this.ensureState()
    const status = this.statusFromState(state)
    if (status.status !== "active" || !status.expiresAt) return
    if (!state.serverUrl || !state.leaseToken) return

    try {
      if (new Date(status.expiresAt).getTime() - this.now().getTime() <= RENEW_BEFORE_EXPIRY_MS) {
        await this.renewState(state)
      } else {
        await this.deps.client.validate(state.serverUrl, {
          leaseToken: state.leaseToken,
          device: createDeviceMetadata(state.deviceId, this.deps.appVersion),
        })
      }
      this.onSyncSuccess()
    } catch (error) {
      if (isTerminalLicenseServerError(error)) {
        await this.clearLease(state)
        this.onSyncSuccess()
        return
      }
      this.onSyncFailure(error)
    }
  }

  private onSyncSuccess(): void {
    this.currentDelayMs = LICENSE_STATUS_CHECK_INTERVAL_MS
    this.consecutiveFailures = 0
  }

  private onSyncFailure(error: unknown): void {
    this.consecutiveFailures++

    if (this.consecutiveFailures <= CONSECUTIVE_WARN_LIMIT) {
      this.deps.logger?.warn("授权状态检查失败。", { error })
    } else if (this.consecutiveFailures === CONSECUTIVE_WARN_LIMIT + 1) {
      this.deps.logger?.info(
        `授权状态检查连续失败 ${this.consecutiveFailures} 次，后续将静默退避重试。`,
      )
    }

    const retryAfterMs =
      error instanceof LicenseClientRequestError ? error.retryAfterMs : undefined

    if (retryAfterMs) {
      this.currentDelayMs = retryAfterMs
    } else {
      this.currentDelayMs = Math.min(this.currentDelayMs * 2, MAX_BACKOFF_MS)
    }
  }

  private scheduleNext(delayMs: number): void {
    this.renewTimer = setTimeout(() => {
      void this.syncWithServer()
        .catch(() => {})
        .finally(() => {
          if (this.renewTimer) {
            this.scheduleNext(this.currentDelayMs)
          }
        })
    }, delayMs)
    this.renewTimer.unref?.()
  }

  private async clearLease(state: CoreLicenseV1): Promise<CoreLicenseV1> {
    const nextState: CoreLicenseV1 = {
      ...state,
      leaseToken: null,
      leaseExpiresAt: null,
    }
    await this.deps.store.setSingleton(nextState)
    return nextState
  }

  private async ensureState(): Promise<CoreLicenseV1> {
    const existing = await this.deps.store.getSingleton()
    if (existing) return existing
    const state: CoreLicenseV1 = {
      id: "license",
      schemaVersion: 1,
      deviceId: this.idFactory(),
      deviceIdHash: null,
      serverUrl: null,
      email: null,
      publicKey: null,
      keyId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      activatedAt: null,
      lastRenewedAt: null,
    }
    await this.deps.store.setSingleton(state)
    return state
  }

  private statusFromState(state: CoreLicenseV1): DesktopLicenseStatus {
    if (!state.leaseToken || !state.publicKey) {
      return {
        status: "not_activated",
        email: state.email,
        serverUrl: state.serverUrl,
        deviceIdHash: state.deviceIdHash,
        expiresAt: null,
        lastRenewedAt: null,
      }
    }

    let payload: LicenseLeasePayload
    try {
      const pinnedKey = state.keyId ? findPinnedKey(state.keyId) : null
      const verifyKey = pinnedKey ? pinnedKey.publicKey : state.publicKey
      payload = verifyLeaseForDevice(state.leaseToken, verifyKey, state.deviceId)
    } catch {
      return {
        status: "invalid",
        email: state.email,
        serverUrl: state.serverUrl,
        deviceIdHash: state.deviceIdHash,
        expiresAt: state.leaseExpiresAt,
        lastRenewedAt: state.lastRenewedAt,
        message: "授权签名无效。",
      }
    }

    const common = {
      email: payload.email,
      serverUrl: state.serverUrl,
      deviceIdHash: payload.deviceIdHash,
      expiresAt: payload.expiresAt,
      lastRenewedAt: state.lastRenewedAt,
    }

    if (payload.licenseStatus !== "active") {
      return {
        ...common,
        status: "invalid",
        message: "授权已不可用。",
      }
    }

    if (new Date(payload.expiresAt).getTime() <= this.now().getTime()) {
      return {
        ...common,
        status: "expired",
        message: "授权已过期。",
      }
    }

    return {
      ...common,
      status: "active",
    }
  }
}

function verifyLeaseForDevice(
  leaseToken: string,
  publicKey: string,
  deviceId: string,
): LicenseLeasePayload {
  const payload = verifyLicenseLease(leaseToken, publicKey)
  if (payload.deviceIdHash !== hashDeviceId(deviceId)) {
    throw new Error("授权设备不匹配。")
  }
  return payload
}

function isTerminalLicenseServerError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return false
  }
  const status = (error as { status: unknown }).status
  return typeof status === "number" && [400, 401, 403, 404, 409].includes(status)
}
