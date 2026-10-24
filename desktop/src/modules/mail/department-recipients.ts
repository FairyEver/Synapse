import { mailRequest } from "@/lib/mail-api"
import type { MailOperationResult } from "@/types/mail"
import type { Draft } from "../../../app-capabilities/mail/shared/types"
import { addressSchema } from "../../../app-capabilities/mail/shared/schema"

type Member = MailOperationResult["organizationMembers"]["items"][number]
export type DepartmentMember = { userId: string; name: string; address: Draft["to"][number] | null; issue: string | null }
export function departmentMember(member: Member): DepartmentMember {
  const name = member.nickname || member.handle || member.userId
  const email = member.contactEmail?.trim()
  const parsed = email ? addressSchema.safeParse({ address: email, name }) : null
  return { userId: member.userId, name, address: parsed?.success ? parsed.data : null, issue: !email ? "未设置联系邮箱" : parsed?.success ? null : "联系邮箱格式无效" }
}

export async function resolveDepartment(organizationId: string, isCurrent: () => boolean = () => true): Promise<DepartmentMember[]> {
  const members = new Map<string, DepartmentMember>(), cursors = new Set<string>()
  let cursor: string | undefined
  // Bound scanning; exceeding this limit fails closed, never returns a partial department.
  for (let page = 0; page < 200; page++) {
    if (!isCurrent()) throw new Error("部门选择已取消")
    const result = await mailRequest({ kind: "organizationMembers", organizationId, cursor })
    if (!isCurrent()) throw new Error("部门选择已取消")
    for (const member of result.items) members.set(member.userId, departmentMember(member))
    if (!result.nextCursor) return [...members.values()]
    if (cursors.has(result.nextCursor)) throw new Error("部门成员分页异常，请重试")
    cursors.add(result.nextCursor); cursor = result.nextCursor
  }
  throw new Error("部门成员过多，无法完整读取，请选择更小的部门")
}

export function mergeDepartmentAddresses(to: Draft["to"], cc: Draft["cc"], field: "to" | "cc", members: DepartmentMember[], excludeMissing: boolean) {
  if (members.some(member => !member.address) && !excludeMissing) throw new Error("请先处理未设置或无效的联系邮箱")
  const additions = members.flatMap(member => member.address ? [member.address] : [])
  if (!additions.length) throw new Error("部门没有可用的联系邮箱")
  const seen = new Set<string>()
  const unique = (addresses: Draft["to"]) => addresses.filter(address => {
    const key = address.address.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  const nextTo = unique([...to, ...(field === "to" ? additions : [])])
  const nextCc = unique([...cc, ...(field === "cc" ? additions : [])])
  if (nextTo.length > 500 || nextCc.length > 500) throw new Error("收件人或抄送超过 500 个地址，请缩小范围")
  return { to: nextTo, cc: nextCc }
}
