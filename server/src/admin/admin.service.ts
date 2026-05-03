import { BadRequestException, Inject, Injectable, InternalServerErrorException, Optional } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { randomBytes } from "node:crypto"
import { z } from "zod"
import { ActivationRiskService } from "../licenses/activation-risk.service"
import { hashActivationCode, normalizeActivationCode } from "../licenses/hash"
import { PrismaService } from "../prisma/prisma.service"

const managedStatusSchema = z.enum(["active", "disabled", "revoked", "expired"])
const deviceStatusSchema = z.enum(["active", "revoked"])
const activationCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const activationCodeCreateAttempts = 5

export function generateActivationCode(): string {
  return `SYN-${randomCodeSegment(4)}-${randomCodeSegment(4)}-${randomCodeSegment(4)}`
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(ActivationRiskService)
    private readonly risk?: Pick<ActivationRiskService, "setRiskLock">,
  ) {}

  async createActivationCode(input: {
    maxDevices: number
    expiresAt?: string | null
    quantity?: number
  }) {
    const results: Array<{ id: string; code: string; maxDevices: number }> = []
    const quantity = input.quantity ?? 1

    for (let index = 0; index < quantity; index += 1) {
      results.push(await this.createSingleActivationCode(input))
    }

    return results
  }

  private async createSingleActivationCode(input: {
    maxDevices: number
    expiresAt?: string | null
  }) {
    for (let attempt = 0; attempt < activationCodeCreateAttempts; attempt += 1) {
      const code = normalizeActivationCode(this.createActivationCodeValue())
      try {
        const activationCode = await this.prisma.activationCode.create({
          data: {
            codeHint: createActivationCodeHint(code),
            codeHash: hashActivationCode(code),
            maxDevices: input.maxDevices,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          },
        })
        return { id: activationCode.id, code, maxDevices: activationCode.maxDevices }
      } catch (error) {
        if (isActivationCodeCollision(error)) {
          continue
        }
        throw error
      }
    }

    throw new InternalServerErrorException("生成唯一激活码失败。")
  }

  protected createActivationCodeValue(): string {
    return generateActivationCode()
  }

  listActivationCodes(options: { readonly includeArchived?: boolean } = {}) {
    const where = options.includeArchived ? undefined : { archivedAt: null }

    return this.prisma.activationCode.findMany({
      orderBy: { createdAt: "desc" },
      ...(where ? { where } : {}),
      select: {
        id: true,
        codeHint: true,
        status: true,
        maxDevices: true,
        expiresAt: true,
        boundAccountId: true,
        boundAccount: {
          select: {
            email: true,
          },
        },
        redeemedAt: true,
        archivedAt: true,
        riskLockedAt: true,
        riskLockedReason: true,
        riskUnlockedAt: true,
        riskReviewNote: true,
        replacedByActivationCodeId: true,
        createdAt: true,
      },
    })
  }

  async updateActivationCode(id: string, body: unknown) {
    const result = z.object({ status: managedStatusSchema }).safeParse(body)
    if (!result.success) {
      throw new BadRequestException("激活码状态无效。")
    }
    const request = result.data
    return this.prisma.activationCode.update({ where: { id }, data: { status: request.status } })
  }

  archiveActivationCode(id: string) {
    return this.prisma.activationCode.update({
      where: { id },
      data: { archivedAt: new Date() },
    })
  }

  listActivationAttempts(id: string) {
    return this.prisma.activationAttempt.findMany({
      where: { activationCodeId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
  }

  updateActivationCodeRiskLock(
    id: string,
    input: { readonly locked: boolean; readonly note?: string | null },
  ) {
    if (!this.risk) {
      throw new InternalServerErrorException("风控服务不可用。")
    }
    return this.risk.setRiskLock(id, input)
  }

  async replaceActivationCode(id: string) {
    const code = normalizeActivationCode(this.createActivationCodeValue())
    return this.prisma.$transaction(async (tx) => {
      const oldCode = await tx.activationCode.findUniqueOrThrow({
        where: { id },
        include: { license: true },
      })
      if (!oldCode.boundAccountId || !oldCode.license) {
        throw new BadRequestException("激活码尚未绑定账号。")
      }

      const newCode = await tx.activationCode.create({
        data: {
          codeHint: createActivationCodeHint(code),
          codeHash: hashActivationCode(code),
          maxDevices: oldCode.maxDevices,
          expiresAt: oldCode.expiresAt,
          boundAccountId: oldCode.boundAccountId,
          redeemedAt: oldCode.redeemedAt ?? new Date(),
        },
      })

      await tx.license.update({
        where: { id: oldCode.license.id },
        data: { activationCodeId: newCode.id },
      })

      await tx.activationCode.update({
        where: { id },
        data: {
          status: "revoked",
          replacedByActivationCodeId: newCode.id,
        },
      })

      return { id: newCode.id, code, maxDevices: newCode.maxDevices }
    })
  }

  listAccounts() {
    return this.prisma.account.findMany({
      orderBy: { createdAt: "desc" },
      include: { licenses: { include: { devices: true } } },
    })
  }

  getAccount(id: string) {
    return this.prisma.account.findUniqueOrThrow({
      where: { id },
      include: {
        licenses: {
          include: {
            devices: true,
            leases: { orderBy: { createdAt: "desc" }, take: 20 },
          },
        },
      },
    })
  }

  listDevices() {
    return this.prisma.device.findMany({
      orderBy: { lastSeenAt: "desc" },
      include: {
        license: {
          include: {
            account: true,
            activationCode: {
              select: {
                id: true,
                codeHint: true,
              },
            },
          },
        },
      },
    })
  }

  async getSystemOverview() {
    const [
      activationCodes,
      activeActivationCodes,
      accounts,
      activeAccounts,
      licenses,
      activeLicenses,
      devices,
      activeDevices,
      leases,
    ] = await this.prisma.$transaction([
      this.prisma.activationCode.count(),
      this.prisma.activationCode.count({ where: { status: "active" } }),
      this.prisma.account.count(),
      this.prisma.account.count({ where: { status: "active" } }),
      this.prisma.license.count(),
      this.prisma.license.count({ where: { status: "active" } }),
      this.prisma.device.count(),
      this.prisma.device.count({ where: { status: "active" } }),
      this.prisma.lease.count(),
    ])

    return {
      serverTime: new Date().toISOString(),
      counts: {
        activationCodes,
        activeActivationCodes,
        accounts,
        activeAccounts,
        licenses,
        activeLicenses,
        devices,
        activeDevices,
        leases,
      },
    }
  }

  async updateLicense(id: string, body: unknown) {
    const result = z.object({ status: managedStatusSchema }).safeParse(body)
    if (!result.success) {
      throw new BadRequestException("授权状态无效。")
    }
    const request = result.data
    return this.prisma.license.update({ where: { id }, data: { status: request.status } })
  }

  async updateDevice(id: string, body: unknown) {
    const result = z.object({ status: deviceStatusSchema }).safeParse(body)
    if (!result.success) {
      throw new BadRequestException("设备状态无效。")
    }
    const request = result.data
    return this.prisma.device.update({ where: { id }, data: { status: request.status } })
  }
}

function randomCodeSegment(length: number): string {
  const bytes = randomBytes(length)
  return Array.from(bytes, (byte) => activationCodeAlphabet[byte % activationCodeAlphabet.length]).join("")
}

function createActivationCodeHint(code: string): string {
  const normalizedCode = normalizeActivationCode(code)
  const parts = normalizedCode.split("-")
  if (parts.length >= 3) {
    return [
      parts[0],
      ...parts.slice(1, -1).map((part) => "*".repeat(part.length)),
      parts[parts.length - 1],
    ].join("-")
  }
  if (normalizedCode.length <= 4) {
    return "*".repeat(normalizedCode.length)
  }
  return `${"*".repeat(Math.max(0, normalizedCode.length - 4))}${normalizedCode.slice(-4)}`
}

function isActivationCodeCollision(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
