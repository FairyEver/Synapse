import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common"
import { hashPassword } from "../auth/password"
import { PrismaService } from "../prisma/prisma.service"

export const adminBootstrapEnvToken = "ADMIN_BOOTSTRAP_ENV"

export interface AdminBootstrapEnv {
  readonly adminEmail: string
  readonly adminPassword: string
}

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(adminBootstrapEnvToken) private readonly env: AdminBootstrapEnv,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    if (existing) return

    await this.prisma.adminUser.create({
      data: {
        email: this.env.adminEmail.trim().toLowerCase(),
        passwordHash: await hashPassword(this.env.adminPassword),
      },
    })
  }
}
