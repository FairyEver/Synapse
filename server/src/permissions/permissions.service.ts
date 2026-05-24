import { BadRequestException, Injectable } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import {
  allPermissionKeys,
  normalizePermissionKeys,
  permissionDefinitions,
} from "./permission-registry"

type PrismaClientLike = PrismaService | Prisma.TransactionClient
type TeamEntitlementSourceInput = "manual" | "plan" | "migration"
type TeamAccessRoleKindInput = "system" | "custom"

export const teamAdminRoleName = "团队管理员"
export const ordinaryMemberRoleName = "普通成员"

const teamManagementPermissions = [
  "team.member.manage",
  "team.role.manage",
  "team.invitation.manage",
] as const
const teamManagementPermissionSet: ReadonlySet<string> = new Set(teamManagementPermissions)

@Injectable()
export class PermissionsService {
  readonly teamAdminRoleName = teamAdminRoleName
  readonly ordinaryMemberRoleName = ordinaryMemberRoleName

  constructor(private readonly prisma: PrismaService) {}

  listPermissionDefinitions() {
    return permissionDefinitions
  }

  async listTeamEntitlements(teamId: string, client: PrismaClientLike = this.prisma): Promise<string[]> {
    const rows = await client.teamEntitlement.findMany({
      where: {
        teamId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { permissionKey: true },
      orderBy: { permissionKey: "asc" },
    })
    return rows.map((row) => row.permissionKey)
  }

  async replaceTeamEntitlements(input: {
    readonly teamId: string
    readonly permissionKeys: readonly string[]
    readonly grantedByAdminId?: string
    readonly source: TeamEntitlementSourceInput
  }): Promise<string[]> {
    const keys = normalizePermissionKeys(input.permissionKeys)
    await this.prisma.$transaction(async (tx) => {
      await tx.teamEntitlement.deleteMany({ where: { teamId: input.teamId } })
      await this.deleteRolePermissionsOutsideTeamEntitlements(input.teamId, keys, tx)
      if (keys.length === 0) return
      await tx.teamEntitlement.createMany({
        data: keys.map((permissionKey) => ({
          teamId: input.teamId,
          permissionKey,
          grantedByAdminId: input.grantedByAdminId,
          source: input.source,
        })),
      })
    })
    return keys
  }

  async ensureDefaultTeamAccess(input: {
    readonly teamId: string
    readonly ownerMembershipId: string
    readonly ownerUserId: string
    readonly client?: PrismaClientLike
  }): Promise<void> {
    const client = input.client ?? this.prisma
    await this.ensureTeamEntitlements(input.teamId, allPermissionKeys, client)
    const adminRole = await this.ensureRole({
      teamId: input.teamId,
      name: teamAdminRoleName,
      kind: "system",
      locked: true,
      sortOrder: 0,
      permissionKeys: allPermissionKeys,
      client,
    })
    await this.ensureRole({
      teamId: input.teamId,
      name: ordinaryMemberRoleName,
      kind: "system",
      locked: true,
      sortOrder: 1,
      permissionKeys: allPermissionKeys.filter((key) => !teamManagementPermissionSet.has(key)),
      client,
    })
    await client.teamMemberAccessRole.createMany({
      data: [{
        teamId: input.teamId,
        teamMembershipId: input.ownerMembershipId,
        roleId: adminRole.id,
        assignedByUserId: input.ownerUserId,
      }],
      skipDuplicates: true,
    })
  }

  async assignOrdinaryMemberRole(input: {
    readonly teamId: string
    readonly teamMembershipId: string
    readonly assignedByUserId?: string
    readonly client?: PrismaClientLike
  }): Promise<void> {
    const client = input.client ?? this.prisma
    const role = await client.teamAccessRole.findFirst({
      where: { teamId: input.teamId, name: ordinaryMemberRoleName },
      select: { id: true },
    })
    if (!role) throw new BadRequestException("团队默认角色不存在。")
    await client.teamMemberAccessRole.createMany({
      data: [{
        teamId: input.teamId,
        teamMembershipId: input.teamMembershipId,
        roleId: role.id,
        assignedByUserId: input.assignedByUserId,
      }],
      skipDuplicates: true,
    })
  }

  async listMemberAccessRoles(
    teamId: string,
    teamMembershipId: string,
    client: PrismaClientLike = this.prisma,
  ) {
    await this.assertTeamMembership(teamId, teamMembershipId, client)
    const rows = await client.teamMemberAccessRole.findMany({
      where: { teamId, teamMembershipId },
      select: {
        assignedAt: true,
        role: {
          select: {
            id: true,
            name: true,
            description: true,
            kind: true,
            locked: true,
            sortOrder: true,
          },
        },
      },
      orderBy: { assignedAt: "asc" },
    })
    return rows.map(({ assignedAt, role }) => ({ ...role, assignedAt }))
  }

  async assignAccessRole(input: {
    readonly teamId: string
    readonly teamMembershipId: string
    readonly roleId: string
    readonly assignedByUserId?: string
  }) {
    await this.prisma.$transaction(async (tx) => {
      await this.assertTeamMembership(input.teamId, input.teamMembershipId, tx)
      await this.assertTeamAccessRole(input.teamId, input.roleId, tx)
      const data: {
        teamId: string
        teamMembershipId: string
        roleId: string
        assignedByUserId?: string
      } = {
        teamId: input.teamId,
        teamMembershipId: input.teamMembershipId,
        roleId: input.roleId,
      }
      if (input.assignedByUserId) data.assignedByUserId = input.assignedByUserId
      await tx.teamMemberAccessRole.createMany({
        data: [data],
        skipDuplicates: true,
      })
    })
    return this.listMemberAccessRoles(input.teamId, input.teamMembershipId)
  }

  async removeAccessRole(input: {
    readonly teamId: string
    readonly teamMembershipId: string
    readonly roleId: string
  }) {
    await this.prisma.$transaction(async (tx) => {
      await this.assertTeamMembership(input.teamId, input.teamMembershipId, tx)
      const result = await tx.teamMemberAccessRole.deleteMany({
        where: {
          teamId: input.teamId,
          teamMembershipId: input.teamMembershipId,
          roleId: input.roleId,
        },
      })
      if (result.count === 0) throw new BadRequestException("成员访问角色不存在。")
    })
    return this.listMemberAccessRoles(input.teamId, input.teamMembershipId)
  }

  async replaceRolePermissions(input: {
    readonly teamId: string
    readonly roleId: string
    readonly permissionKeys: readonly string[]
  }): Promise<string[]> {
    const keys = normalizePermissionKeys(input.permissionKeys)
    await this.prisma.$transaction(async (tx) => {
      const role = await tx.teamAccessRole.findFirst({
        where: { id: input.roleId, teamId: input.teamId },
        select: { id: true },
      })
      if (!role) throw new BadRequestException("团队角色不存在。")
      await this.assertWithinTeamEntitlements(input.teamId, keys, tx)
      await tx.teamAccessRolePermission.deleteMany({ where: { roleId: input.roleId } })
      if (keys.length === 0) return
      await tx.teamAccessRolePermission.createMany({
        data: keys.map((permissionKey) => ({ roleId: input.roleId, permissionKey })),
      })
    })
    return keys
  }

  async getEffectivePermissions(userId: string, teamId: string): Promise<string[]> {
    const [entitlements, roleAssignments] = await Promise.all([
      this.listTeamEntitlements(teamId),
      this.prisma.teamMemberAccessRole.findMany({
        where: {
          teamMembership: { userId, teamId },
        },
        include: {
          role: {
            include: {
              permissions: { select: { permissionKey: true } },
            },
          },
        },
      }),
    ])
    const entitlementSet = new Set(entitlements)
    const permissionKeys = new Set<string>()
    for (const assignment of roleAssignments) {
      for (const permission of assignment.role.permissions) {
        if (entitlementSet.has(permission.permissionKey)) {
          permissionKeys.add(permission.permissionKey)
        }
      }
    }
    return [...permissionKeys].sort()
  }

  private async ensureTeamEntitlements(
    teamId: string,
    permissionKeys: readonly string[],
    client: PrismaClientLike,
  ): Promise<void> {
    const keys = normalizePermissionKeys(permissionKeys)
    if (keys.length === 0) return
    await client.teamEntitlement.createMany({
      data: keys.map((permissionKey) => ({ teamId, permissionKey, source: "plan" })),
      skipDuplicates: true,
    })
  }

  private async ensureRole(input: {
    readonly teamId: string
    readonly name: string
    readonly kind: TeamAccessRoleKindInput
    readonly locked: boolean
    readonly sortOrder: number
    readonly permissionKeys: readonly string[]
    readonly client: PrismaClientLike
  }): Promise<{ id: string }> {
    const existing = await input.client.teamAccessRole.findFirst({
      where: { teamId: input.teamId, name: input.name },
      select: { id: true },
    })
    const role = existing ?? await input.client.teamAccessRole.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        kind: input.kind,
        locked: input.locked,
        sortOrder: input.sortOrder,
      },
      select: { id: true },
    })
    const keys = normalizePermissionKeys(input.permissionKeys)
    await input.client.teamAccessRolePermission.deleteMany({
      where: { roleId: role.id },
    })
    if (keys.length > 0) {
      await input.client.teamAccessRolePermission.createMany({
        data: keys.map((permissionKey) => ({ roleId: role.id, permissionKey })),
      })
    }
    return role
  }

  private async assertWithinTeamEntitlements(
    teamId: string,
    permissionKeys: readonly string[],
    client: PrismaClientLike = this.prisma,
  ): Promise<void> {
    const entitlements = new Set(await this.listTeamEntitlements(teamId, client))
    const missing = permissionKeys.filter((key) => !entitlements.has(key))
    if (missing.length > 0) {
      throw new BadRequestException(`权限未对团队开通：${missing.join("，")}`)
    }
  }

  private async assertTeamMembership(
    teamId: string,
    teamMembershipId: string,
    client: PrismaClientLike,
  ): Promise<void> {
    const membership = await client.teamMembership.findFirst({
      where: { id: teamMembershipId, teamId },
      select: { id: true },
    })
    if (!membership) throw new BadRequestException("团队成员不存在。")
  }

  private async assertTeamAccessRole(
    teamId: string,
    roleId: string,
    client: PrismaClientLike,
  ): Promise<void> {
    const role = await client.teamAccessRole.findFirst({
      where: { id: roleId, teamId },
      select: { id: true },
    })
    if (!role) throw new BadRequestException("团队角色不存在。")
  }

  private async deleteRolePermissionsOutsideTeamEntitlements(
    teamId: string,
    permissionKeys: readonly string[],
    client: PrismaClientLike,
  ): Promise<void> {
    await client.teamAccessRolePermission.deleteMany({
      where: {
        role: { teamId },
        ...(permissionKeys.length > 0 ? { permissionKey: { notIn: [...permissionKeys] } } : {}),
      },
    })
  }
}
