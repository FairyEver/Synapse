import { BadRequestException, ForbiddenException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { descendantIds } from "../team/organization-tree"

export type MailAddress = { kind: "user"; userId: string; name: string } | { kind: "organization"; organizationId: string; name: string } | { kind: "audience"; name: string }
export type MailAddressSnapshot = { to: MailAddress[]; cc: MailAddress[] }

export async function resolveMailAddresses(
  db: Prisma.TransactionClient,
  senderId: string,
  toIds: string[],
  ccIds: string[],
  toOrganizationIds: string[],
  ccOrganizationIds: string[],
  fixedTeamId?: string,
) {
  const directIds = [...new Set([...toIds, ...ccIds])]
  const selectedOrganizationIds = [...new Set([...toOrganizationIds, ...ccOrganizationIds])]
  if (directIds.includes(senderId)) throw new BadRequestException("不能给自己发送站内信。")
  if (!toIds.length && !toOrganizationIds.length) throw new BadRequestException("请选择收件人。")

  const organizations = selectedOrganizationIds.length ? await db.organization.findMany({ where: { id: { in: selectedOrganizationIds } }, select: { id: true, teamId: true, name: true, parentId: true } }) : []
  if (organizations.length !== selectedOrganizationIds.length) throw new ForbiddenException("组织已失效，请重新选择。")
  const organizationTeams = [...new Set(organizations.map((item) => item.teamId))]
  if (organizationTeams.length > 1 || (fixedTeamId && organizationTeams.length && organizationTeams[0] !== fixedTeamId)) throw new ForbiddenException("一封信只能选择同一团队的组织。")

  const participants = await db.user.findMany({ where: { id: { in: [senderId, ...directIds] }, status: "active" }, select: { id: true, nickname: true, handle: true, teamMemberships: { select: { teamId: true } } } })
  if (participants.length !== directIds.length + 1) throw new ForbiddenException("收件人已失效。")
  const sender = participants.find((user) => user.id === senderId)
  if (!sender) throw new ForbiddenException("发件人已失效。")
  const common = participants.reduce<string[]>((shared, user) => shared.filter((id) => user.teamMemberships.some((item) => item.teamId === id)), sender.teamMemberships.map((item) => item.teamId))
  const teamId = fixedTeamId ?? organizationTeams[0] ?? [...common].sort()[0]
  if (!teamId || !common.includes(teamId)) throw new ForbiddenException("所有收件人必须与发件人在同一团队。")
  const team = await db.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } })
  if (!team) throw new ForbiddenException("团队不存在。")

  const allOrganizations = selectedOrganizationIds.length ? await db.organization.findMany({ where: { teamId }, select: { id: true, parentId: true } }) : []
  const toSubtree = new Set(toOrganizationIds.flatMap((id) => descendantIds(allOrganizations, id)))
  const ccSubtree = new Set(ccOrganizationIds.flatMap((id) => descendantIds(allOrganizations, id)))
  const memberRows = selectedOrganizationIds.length ? await db.organizationMembership.findMany({ where: { organizationId: { in: [...new Set([...toSubtree, ...ccSubtree])] }, user: { status: "active" } }, select: { organizationId: true, userId: true } }) : []
  const to = new Set([...toIds, ...memberRows.filter((row) => toSubtree.has(row.organizationId)).map((row) => row.userId)])
  const cc = new Set([...ccIds, ...memberRows.filter((row) => ccSubtree.has(row.organizationId)).map((row) => row.userId)])
  to.delete(senderId)
  cc.delete(senderId)
  for (const id of to) cc.delete(id)
  if (!to.size) throw new BadRequestException("收件组织没有可投递的成员。")

  const userById = new Map(participants.map((user) => [user.id, user]))
  const organizationById = new Map(organizations.map((item) => [item.id, item]))
  const personAddress = (id: string): MailAddress => {
    const person = userById.get(id)!
    return { kind: "user", userId: id, name: person.nickname || person.handle || id }
  }
  const organizationAddress = (id: string): MailAddress => ({ kind: "organization", organizationId: id, name: organizationById.get(id)!.name })
  const addressSnapshot: MailAddressSnapshot = {
    to: [...toIds.map(personAddress), ...toOrganizationIds.map(organizationAddress)],
    cc: [...ccIds.filter((id) => !toIds.includes(id)).map(personAddress), ...ccOrganizationIds.filter((id) => !toOrganizationIds.includes(id)).map(organizationAddress)],
  }
  return { team, toIds: [...to], ccIds: [...cc], addressSnapshot, directPeople: participants }
}
