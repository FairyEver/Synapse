import { Injectable } from "@nestjs/common"
import { z } from "zod"
import { hashActivationCode, normalizeActivationCode } from "../licenses/hash"
import { PrismaService } from "../prisma/prisma.service"

const managedStatusSchema = z.enum(["active", "disabled", "revoked", "expired"])
const deviceStatusSchema = z.enum(["active", "revoked"])

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createActivationCode(input: {
    code: string
    maxDevices: number
    expiresAt?: string | null
  }) {
    const normalizedCode = normalizeActivationCode(input.code)
    const activationCode = await this.prisma.activationCode.create({
      data: {
        codeHash: hashActivationCode(normalizedCode),
        maxDevices: input.maxDevices,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    })
    return { id: activationCode.id, code: normalizedCode, maxDevices: activationCode.maxDevices }
  }

  listActivationCodes() {
    return this.prisma.activationCode.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        maxDevices: true,
        expiresAt: true,
        boundAccountId: true,
        redeemedAt: true,
        createdAt: true,
      },
    })
  }

  async updateActivationCode(id: string, body: unknown) {
    const request = z.object({ status: managedStatusSchema }).parse(body)
    return this.prisma.activationCode.update({ where: { id }, data: { status: request.status } })
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

  async updateLicense(id: string, body: unknown) {
    const request = z.object({ status: managedStatusSchema }).parse(body)
    return this.prisma.license.update({ where: { id }, data: { status: request.status } })
  }

  async updateDevice(id: string, body: unknown) {
    const request = z.object({ status: deviceStatusSchema }).parse(body)
    return this.prisma.device.update({ where: { id }, data: { status: request.status } })
  }
}
