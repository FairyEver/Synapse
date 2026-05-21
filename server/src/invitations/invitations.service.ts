import { BadRequestException, Injectable } from "@nestjs/common"
import { Prisma, type InvitationType } from "@prisma/client"
import { createOpaqueToken, hashToken } from "../auth/token"
import { PrismaService } from "../prisma/prisma.service"

const invitationDays = 7

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createSignupInvitation(input: { readonly adminId: string }) {
    const token = createOpaqueToken()
    const invitation = await this.prisma.invitation.create({
      data: {
        type: "user_signup",
        tokenHash: hashToken(token),
        expiresAt: addDays(new Date(), invitationDays),
        createdByAdminId: input.adminId,
      },
    })
    return { id: invitation.id, token, expiresAt: invitation.expiresAt }
  }

  async createTeamInvitation(input: { readonly userId: string; readonly teamId: string }) {
    const token = createOpaqueToken()
    const invitation = await this.prisma.invitation.create({
      data: {
        type: "team_join",
        tokenHash: hashToken(token),
        expiresAt: addDays(new Date(), invitationDays),
        createdByUserId: input.userId,
        teamId: input.teamId,
      },
    })
    return { id: invitation.id, token, expiresAt: invitation.expiresAt }
  }

  async consumeInvitation(
    input: {
      readonly token: string
      readonly type: InvitationType
      readonly acceptedByUserId: string
    },
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const invitation = await client.invitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
    })
    if (!invitation || invitation.type !== input.type || invitation.usedAt || invitation.expiresAt <= new Date()) {
      throw new BadRequestException("邀请无效或已过期。")
    }

    return client.invitation.update({
      where: { id: invitation.id },
      data: {
        usedAt: new Date(),
        acceptedByUserId: input.acceptedByUserId,
      },
    })
  }
}
