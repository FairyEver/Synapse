import { BadRequestException, NotFoundException } from "@nestjs/common"
import { buildPasswordResetUrl } from "@synapse/shared"
import type { PrismaService } from "../prisma/prisma.service"
import { createOpaqueToken, hashToken } from "./token"

export const passwordResetTokenTtlMs = 30 * 60 * 1000

export interface PasswordResetLinkResult {
  readonly ok: true
  readonly resetUrl: string
  readonly expiresAt: Date
}

export async function createPasswordResetLink(
  prisma: PrismaService,
  userId: string,
  publicAppUrl: string,
): Promise<PasswordResetLinkResult> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + passwordResetTokenTtlMs)
  const token = createOpaqueToken()

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true },
    })
    if (!user) throw new NotFoundException("用户不存在。")
    if (user.status !== "active") throw new BadRequestException("请先启用用户。")

    await tx.userPasswordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    })
    await tx.userPasswordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt,
      },
    })

    return {
      ok: true,
      resetUrl: buildPasswordResetUrl({ publicAppUrl, token }),
      expiresAt,
    }
  })
}
