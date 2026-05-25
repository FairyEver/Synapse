import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { modulePermissionDefinitions, normalizeModulePermissionKeys } from "./permission-registry"

type PrismaClientLike = PrismaService | Prisma.TransactionClient

export interface ReplaceUserModulePermissionsResult {
  readonly before: string[]
  readonly after: string[]
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  listModulePermissionDefinitions() {
    return modulePermissionDefinitions
  }

  async listUserModulePermissions(userId: string, client: PrismaClientLike = this.prisma): Promise<string[]> {
    const rows = await client.userModulePermission.findMany({
      where: { userId },
      select: { permissionKey: true },
    })
    return normalizeModulePermissionKeys(rows.map((row) => row.permissionKey))
  }

  async replaceUserModulePermissions(input: {
    readonly userId: string
    readonly permissionKeys: readonly string[]
    readonly grantedByAdminId?: string
  }): Promise<ReplaceUserModulePermissionsResult> {
    let nextKeys: string[]
    try {
      nextKeys = normalizeModulePermissionKeys(input.permissionKeys)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "模块权限无效。")
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      })
      if (!user) throw new NotFoundException("用户不存在。")

      const before = await this.listUserModulePermissions(input.userId, tx)
      await tx.userModulePermission.deleteMany({
        where: {
          userId: input.userId,
          permissionKey: { notIn: nextKeys },
        },
      })
      if (nextKeys.length > 0) {
        await tx.userModulePermission.createMany({
          data: nextKeys.map((permissionKey) => ({
            userId: input.userId,
            permissionKey,
            grantedByAdminId: input.grantedByAdminId,
          })),
          skipDuplicates: true,
        })
      }
      return { before, after: nextKeys }
    })
  }
}
