import { BadRequestException, Injectable } from "@nestjs/common"
import { Prisma, type InvitationType } from "@prisma/client"
import { createOpaqueToken, hashToken } from "../auth/token"
import { PrismaService } from "../prisma/prisma.service"
import { buildSignupInviteUrl, buildTeamInviteUrl, parseInviteTokenInput } from "./invitation-url"

const invitationDays = 7

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createSignupInvitation(input: { readonly adminId: string; readonly publicAppUrl: string }) {
    const token = createOpaqueToken()
    const inviteUrl = buildSignupInviteUrl({ publicAppUrl: input.publicAppUrl, token })
    const invitation = await this.prisma.invitation.create({
      data: {
        type: "user_signup",
        tokenHash: hashToken(token),
        inviteUrl,
        expiresAt: addDays(new Date(), invitationDays),
        createdByAdminId: input.adminId,
      },
    })
    return {
      id: invitation.id,
      token,
      inviteUrl,
      expiresAt: invitation.expiresAt,
    }
  }

  async createTeamInvitation(input: { readonly userId: string; readonly teamId: string; readonly publicAppUrl: string }) {
    const token = createOpaqueToken()
    const inviteUrl = buildTeamInviteUrl({ publicAppUrl: input.publicAppUrl, token })
    const invitation = await this.prisma.invitation.create({
      data: {
        type: "team_join",
        tokenHash: hashToken(token),
        inviteUrl,
        expiresAt: addDays(new Date(), invitationDays),
        createdByUserId: input.userId,
        teamId: input.teamId,
      },
    })
    return {
      id: invitation.id,
      token,
      inviteUrl,
      expiresAt: invitation.expiresAt,
    }
  }

  async consumeInvitation(
    input: {
      readonly token: string
      readonly type: InvitationType
      readonly acceptedByUserId: string
    },
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const tokenHash = hashToken(parseInviteTokenInput(input.token))
    const consumedAt = new Date()
    const update = await client.invitation.updateMany({
      where: {
        tokenHash,
        type: input.type,
        usedAt: null,
        expiresAt: { gt: consumedAt },
      },
      data: {
        usedAt: consumedAt,
        acceptedByUserId: input.acceptedByUserId,
      },
    })

    if (update.count !== 1) {
      throw new BadRequestException("邀请无效或已过期。")
    }

    const invitation = await client.invitation.findUnique({
      where: { tokenHash },
    })

    if (!invitation) throw new BadRequestException("邀请无效或已过期。")

    return invitation
  }
}
