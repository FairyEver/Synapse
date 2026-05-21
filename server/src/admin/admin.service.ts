import { Injectable } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getSystemOverview() {
    const [auditLogs] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
    ])

    return {
      serverTime: new Date().toISOString(),
      counts: {
        auditLogs,
      },
    }
  }
}
