import type { CoreLicenseV1, DataNamespace } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import { createDeviceId, createDeviceMetadata, hashDeviceId } from "./device-id"
import { LicenseClient, normalizeLicenseServerUrl } from "./license-client"
import { verifyLicenseLease } from "./license-token"
import type {
  DesktopLicenseActivationRequest,
  DesktopLicenseStatus,
  LicenseLeasePayload,
} from "./types"

const RENEW_BEFORE_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000
const LICENSE_STATUS_CHECK_INTERVAL_MS = 60 * 1000

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

  constructor(private readonly deps: LicenseServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? createDeviceId
  }

  start(): void {
    if (this.renewTimer) return
    void this.syncWithServer().catch((error) => {
      this.deps.logger?.warn("授权状态检查失败。", { error })
    })
    this.renewTimer = setInterval(() => {
      void this.syncWithServer().catch((error) => {
        this.deps.logger?.warn("授权状态检查失败。", { error })
      })
    }, LICENSE_STATUS_CHECK_INTERVAL_MS)
    this.renewTimer.unref?.()
  }

  stop(): void {
    if (!this.renewTimer) return
    clearInterval(this.renewTimer)
    this.renewTimer = null
  }

  async getStatus(): Promise<DesktopLicenseStatus> {
    const state = await this.ensureState()
    return this.statusFromState(state)
  }

  async activate(input: DesktopLicenseActivationRequest): Promise<DesktopLicenseStatus> {
    const state = await this.ensureState()
    const serverUrl = normalizeLicenseServerUrl(input.serverUrl)
    const config = await this.deps.client.getConfig(serverUrl)
    const device = createDeviceMetadata(state.deviceId, this.deps.appVersion)
    const response = await this.deps.client.redeem(serverUrl, {
      email: input.email.trim().toLowerCase(),
      activationCode: input.activationCode,
      device,
    })
    const payload = verifyLeaseForDevice(response.leaseToken, config.publicKey, state.deviceId)
    const nextState: CoreLicenseV1 = {
      ...state,
      serverUrl,
      email: response.email,
      publicKey: config.publicKey,
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
    const response = await this.deps.client.renew(state.serverUrl, {
      leaseToken: state.leaseToken,
      device: createDeviceMetadata(state.deviceId, this.deps.appVersion),
    })
    const payload = verifyLeaseForDevice(response.leaseToken, config.publicKey, state.deviceId)
    const nextState: CoreLicenseV1 = {
      ...state,
      email: response.email,
      publicKey: config.publicKey,
      keyId: config.keyId,
      leaseToken: response.leaseToken,
      leaseExpiresAt: payload.expiresAt,
      deviceIdHash: response.deviceIdHash,
      lastRenewedAt: this.now().toISOString(),
    }
    await this.deps.store.setSingleton(nextState)
    return nextState
  }

  private async syncWithServer(): Promise<void> {
    const state = await this.ensureState()
    const status = this.statusFromState(state)
    if (status.status !== "active" || !status.expiresAt) return
    if (!state.serverUrl || !state.leaseToken) return

    try {
      if (new Date(status.expiresAt).getTime() - this.now().getTime() <= RENEW_BEFORE_EXPIRY_MS) {
        await this.renewState(state)
        return
      }

      await this.deps.client.validate(state.serverUrl, {
        leaseToken: state.leaseToken,
        device: createDeviceMetadata(state.deviceId, this.deps.appVersion),
      })
    } catch (error) {
      if (isTerminalLicenseServerError(error)) {
        await this.clearLease(state)
        return
      }
      this.deps.logger?.warn("授权状态检查失败。", { error })
    }
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
      payload = verifyLeaseForDevice(state.leaseToken, state.publicKey, state.deviceId)
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
