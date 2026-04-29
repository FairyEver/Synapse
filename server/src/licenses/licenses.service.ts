import { Injectable } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { PrismaService } from "../prisma/prisma.service"
import { hashActivationCode, hashDeviceId } from "./hash"
import { signLicenseLease, verifyLicenseLease } from "./license-token"
import type { DeviceMetadata, LicenseLeasePayload, ManagedStatus } from "./license.types"

interface LicenseSettings {
  readonly privateKey: string
  readonly publicKey: string
  readonly keyId: string
  readonly leaseDays: number
}

interface ActivationRecord {
  readonly id: string
  readonly codeHash: string
  status: ManagedStatus
  readonly maxDevices: number
  boundAccountId: string | null
  readonly expiresAt?: Date | null
}

interface AccountRecord {
  readonly id: string
  readonly email: string
  readonly status: "active" | "disabled"
}

interface LicenseRecord {
  readonly id: string
  readonly accountId: string
  readonly activationCodeId: string
  readonly status: ManagedStatus
  readonly maxDevices: number
  readonly expiresAt?: Date | null
}

interface DeviceRecord {
  readonly id: string
  readonly licenseId: string
  readonly deviceIdHash: string
  name: string
  platform: string
  appVersion: string
  readonly status: "active" | "revoked"
}

interface RedeemRequest {
  readonly email: string
  readonly activationCode: string
  readonly device: DeviceMetadata
}

interface RenewRequest {
  readonly leaseToken: string
  readonly device: DeviceMetadata
}

interface LicenseResponse {
  readonly email: string
  readonly deviceIdHash: string
  readonly leaseToken: string
}

interface LicenseValidationResponse {
  readonly ok: true
}

interface RenewalContext {
  readonly account: AccountRecord
  readonly license: LicenseRecord
  readonly device: DeviceRecord
}

interface LicenseRepository {
  findActivationByHash(codeHash: string): Promise<ActivationRecord | null>
  findOrCreateAccount(email: string): Promise<AccountRecord>
  bindActivationToAccount(activationId: string, accountId: string): Promise<void>
  findOrCreateLicense(accountId: string, activation: ActivationRecord): Promise<LicenseRecord>
  findDevicesByLicense(licenseId: string): Promise<DeviceRecord[]>
  createDevice(license: LicenseRecord, metadata: DeviceMetadata, deviceIdHash: string): Promise<DeviceRecord>
  updateDeviceMetadata(deviceId: string, metadata: DeviceMetadata): Promise<void>
  createLease(input: {
    licenseId: string
    deviceId: string
    tokenId: string
    issuedAt: Date
    expiresAt: Date
    statusSnapshot: Record<string, unknown>
  }): Promise<void>
  findRenewalState(
    licenseId: string,
    deviceIdHash: string,
  ): Promise<{
    account: AccountRecord | null
    activation: ActivationRecord | null
    license: LicenseRecord | null
    device: DeviceRecord | null
  }>
}

@Injectable()
export class LicensesService {
  constructor(
    private readonly settings: LicenseSettings,
    private readonly repository: LicenseRepository,
  ) {}

  static createInMemory(settings: LicenseSettings): LicensesService {
    return new LicensesService(settings, new InMemoryLicenseRepository())
  }

  static createWithPrisma(settings: LicenseSettings, prisma: PrismaService): LicensesService {
    return new LicensesService(settings, new PrismaLicenseRepository(prisma))
  }

  seedActivationCode(input: { codeHash: string; maxDevices: number }): void {
    if (!(this.repository instanceof InMemoryLicenseRepository)) {
      throw new Error("seedActivationCode 仅可用于内存测试。")
    }
    this.repository.seedActivationCode(input)
  }

  getPublicConfig(): { keyId: string; leaseDays: number; serverTime: string; publicKey: string } {
    return {
      keyId: this.settings.keyId,
      leaseDays: this.settings.leaseDays,
      serverTime: new Date().toISOString(),
      publicKey: this.settings.publicKey,
    }
  }

  async redeem(request: RedeemRequest): Promise<LicenseResponse> {
    const email = normalizeEmail(request.email)
    const codeHash = hashActivationCode(request.activationCode)
    const activation = await this.repository.findActivationByHash(codeHash)

    if (!activation || activation.status !== "active" || isPast(activation.expiresAt)) {
      throw new Error("激活码无效。")
    }

    const account = await this.repository.findOrCreateAccount(email)
    if (account.status !== "active") {
      throw new Error("账号已停用。")
    }

    if (activation.boundAccountId && activation.boundAccountId !== account.id) {
      throw new Error("激活码已绑定其他账号。")
    }
    if (!activation.boundAccountId) {
      await this.repository.bindActivationToAccount(activation.id, account.id)
      activation.boundAccountId = account.id
    }

    const license = await this.repository.findOrCreateLicense(account.id, activation)
    if (license.status !== "active" || isPast(license.expiresAt)) {
      throw new Error("授权不可用。")
    }

    const device = await this.findOrCreateDevice(license, request.device)
    const leaseToken = await this.issueLease(account, license, device)

    return { email, deviceIdHash: device.deviceIdHash, leaseToken }
  }

  async renew(request: RenewRequest): Promise<LicenseResponse> {
    const { account, license, device } = await this.getRenewalContext(request)

    await this.repository.updateDeviceMetadata(device.id, request.device)
    const updatedDevice = {
      ...device,
      name: request.device.name,
      platform: request.device.platform,
      appVersion: request.device.appVersion,
    }

    return {
      email: account.email,
      deviceIdHash: updatedDevice.deviceIdHash,
      leaseToken: await this.issueLease(account, license, updatedDevice),
    }
  }

  async validate(request: RenewRequest): Promise<LicenseValidationResponse> {
    await this.getRenewalContext(request)
    return { ok: true }
  }

  private async getRenewalContext(request: RenewRequest): Promise<RenewalContext> {
    const payload = verifyLicenseLease(request.leaseToken, this.settings.publicKey)
    const deviceHash = hashDeviceId(request.device.deviceId)
    if (payload.deviceIdHash !== deviceHash) {
      throw new Error("当前设备与授权不匹配。")
    }

    const { account, activation, license, device } = await this.repository.findRenewalState(
      payload.licenseId,
      deviceHash,
    )

    if (!account || account.status !== "active") {
      throw new Error("账号已停用。")
    }
    if (!activation || activation.status !== "active" || isPast(activation.expiresAt)) {
      throw new Error("授权不可用。")
    }
    if (!license || license.status !== "active" || isPast(license.expiresAt)) {
      throw new Error("授权不可用。")
    }
    if (!device || device.status !== "active") {
      throw new Error("设备已停用。")
    }

    return { account, license, device }
  }

  private async findOrCreateDevice(
    license: LicenseRecord,
    metadata: DeviceMetadata,
  ): Promise<DeviceRecord> {
    const deviceIdHash = hashDeviceId(metadata.deviceId)
    const devices = await this.repository.findDevicesByLicense(license.id)
    const existing = devices.find((device) => device.deviceIdHash === deviceIdHash)
    if (existing) {
      if (existing.status !== "active") {
        throw new Error("设备已停用。")
      }
      return existing
    }

    const activeCount = devices.filter((device) => device.status === "active").length
    if (activeCount >= license.maxDevices) {
      throw new Error("设备数量已达上限。")
    }

    return this.repository.createDevice(license, metadata, deviceIdHash)
  }

  private async issueLease(
    account: AccountRecord,
    license: LicenseRecord,
    device: DeviceRecord,
  ): Promise<string> {
    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + this.settings.leaseDays * 24 * 60 * 60 * 1000)
    const payload: LicenseLeasePayload = {
      tokenId: randomUUID(),
      accountId: account.id,
      email: account.email,
      licenseId: license.id,
      deviceIdHash: device.deviceIdHash,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      maxDevices: license.maxDevices,
      licenseStatus: license.status,
      keyId: this.settings.keyId,
    }
    await this.repository.createLease({
      licenseId: license.id,
      deviceId: device.id,
      tokenId: payload.tokenId,
      issuedAt,
      expiresAt,
      statusSnapshot: {
        accountStatus: account.status,
        licenseStatus: license.status,
        deviceStatus: device.status,
      },
    })
    return signLicenseLease(payload, this.settings.privateKey)
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isPast(value: Date | null | undefined): boolean {
  return value ? value.getTime() <= Date.now() : false
}

class InMemoryLicenseRepository implements LicenseRepository {
  private readonly activations = new Map<string, ActivationRecord>()
  private readonly accounts = new Map<string, AccountRecord>()
  private readonly licenses = new Map<string, LicenseRecord>()
  private readonly devices = new Map<string, DeviceRecord>()

  seedActivationCode(input: { codeHash: string; maxDevices: number }): void {
    this.activations.set(input.codeHash, {
      id: randomUUID(),
      codeHash: input.codeHash,
      status: "active",
      maxDevices: input.maxDevices,
      boundAccountId: null,
    })
  }

  async findActivationByHash(codeHash: string): Promise<ActivationRecord | null> {
    return this.activations.get(codeHash) ?? null
  }

  async findOrCreateAccount(email: string): Promise<AccountRecord> {
    const existing = [...this.accounts.values()].find((account) => account.email === email)
    if (existing) return existing
    const account: AccountRecord = { id: randomUUID(), email, status: "active" }
    this.accounts.set(account.id, account)
    return account
  }

  async bindActivationToAccount(activationId: string, accountId: string): Promise<void> {
    const activation = [...this.activations.values()].find((item) => item.id === activationId)
    if (activation) {
      activation.boundAccountId = accountId
    }
  }

  async findOrCreateLicense(accountId: string, activation: ActivationRecord): Promise<LicenseRecord> {
    const existing = [...this.licenses.values()].find((license) =>
      license.activationCodeId === activation.id,
    )
    if (existing) return existing
    const license: LicenseRecord = {
      id: randomUUID(),
      accountId,
      activationCodeId: activation.id,
      status: "active",
      maxDevices: activation.maxDevices,
    }
    this.licenses.set(license.id, license)
    return license
  }

  async findDevicesByLicense(licenseId: string): Promise<DeviceRecord[]> {
    return [...this.devices.values()].filter((device) => device.licenseId === licenseId)
  }

  async createDevice(
    license: LicenseRecord,
    metadata: DeviceMetadata,
    deviceIdHash: string,
  ): Promise<DeviceRecord> {
    const device: DeviceRecord = {
      id: randomUUID(),
      licenseId: license.id,
      deviceIdHash,
      name: metadata.name,
      platform: metadata.platform,
      appVersion: metadata.appVersion,
      status: "active",
    }
    this.devices.set(device.id, device)
    return device
  }

  async updateDeviceMetadata(deviceId: string, metadata: DeviceMetadata): Promise<void> {
    const device = this.devices.get(deviceId)
    if (device) {
      device.name = metadata.name
      device.platform = metadata.platform
      device.appVersion = metadata.appVersion
    }
  }

  async createLease(): Promise<void> {
    return undefined
  }

  async findRenewalState(
    licenseId: string,
    deviceIdHash: string,
  ): Promise<{
    account: AccountRecord | null
    activation: ActivationRecord | null
    license: LicenseRecord | null
    device: DeviceRecord | null
  }> {
    const license = this.licenses.get(licenseId) ?? null
    const account = license ? this.accounts.get(license.accountId) ?? null : null
    const activation = license
      ? [...this.activations.values()].find((item) => item.id === license.activationCodeId) ?? null
      : null
    const device = [...this.devices.values()].find((item) =>
      item.licenseId === licenseId && item.deviceIdHash === deviceIdHash,
    ) ?? null

    return { account, activation, license, device }
  }
}

class PrismaLicenseRepository implements LicenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActivationByHash(codeHash: string): Promise<ActivationRecord | null> {
    return this.prisma.activationCode.findUnique({ where: { codeHash } })
  }

  async findOrCreateAccount(email: string): Promise<AccountRecord> {
    return this.prisma.account.upsert({
      where: { email },
      update: {},
      create: { email },
    })
  }

  async bindActivationToAccount(activationId: string, accountId: string): Promise<void> {
    await this.prisma.activationCode.update({
      where: { id: activationId },
      data: {
        boundAccountId: accountId,
        redeemedAt: new Date(),
      },
    })
  }

  async findOrCreateLicense(accountId: string, activation: ActivationRecord): Promise<LicenseRecord> {
    const existing = await this.prisma.license.findUnique({
      where: { activationCodeId: activation.id },
    })
    if (existing) return existing

    return this.prisma.license.create({
      data: {
        accountId,
        activationCodeId: activation.id,
        maxDevices: activation.maxDevices,
        expiresAt: activation.expiresAt ?? null,
      },
    })
  }

  async findDevicesByLicense(licenseId: string): Promise<DeviceRecord[]> {
    return this.prisma.device.findMany({ where: { licenseId } })
  }

  async createDevice(
    license: LicenseRecord,
    metadata: DeviceMetadata,
    deviceIdHash: string,
  ): Promise<DeviceRecord> {
    return this.prisma.device.create({
      data: {
        licenseId: license.id,
        deviceIdHash,
        name: metadata.name,
        platform: metadata.platform,
        appVersion: metadata.appVersion,
      },
    })
  }

  async updateDeviceMetadata(deviceId: string, metadata: DeviceMetadata): Promise<void> {
    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        name: metadata.name,
        platform: metadata.platform,
        appVersion: metadata.appVersion,
        lastSeenAt: new Date(),
      },
    })
  }

  async createLease(input: {
    licenseId: string
    deviceId: string
    tokenId: string
    issuedAt: Date
    expiresAt: Date
    statusSnapshot: Record<string, unknown>
  }): Promise<void> {
    await this.prisma.lease.create({
      data: {
        ...input,
        statusSnapshot: input.statusSnapshot as Prisma.InputJsonObject,
      },
    })
  }

  async findRenewalState(
    licenseId: string,
    deviceIdHash: string,
  ): Promise<{
    account: AccountRecord | null
    activation: ActivationRecord | null
    license: LicenseRecord | null
    device: DeviceRecord | null
  }> {
    const license = await this.prisma.license.findUnique({ where: { id: licenseId } })
    const account = license
      ? await this.prisma.account.findUnique({ where: { id: license.accountId } })
      : null
    const activation = license
      ? await this.prisma.activationCode.findUnique({ where: { id: license.activationCodeId } })
      : null
    const device = await this.prisma.device.findUnique({
      where: { licenseId_deviceIdHash: { licenseId, deviceIdHash } },
    })

    return { account, activation, license, device }
  }
}
