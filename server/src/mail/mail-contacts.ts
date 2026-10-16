import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

type MailBox = "inbox" | "sent"
export type MailContactRow = {
  key: string; kind: "user" | "organization" | "platform"; name: string
  handle: string | null; teamName: string | null; unread: number; lastSentAt: Date
}

/** 联系人只缩小当前信箱的可见范围，不能代替账号/副本权限条件。 */
export function mailContactFilter(box: MailBox, key?: string): Prisma.MailMessageWhereInput {
  if (key === undefined) return {}
  if (typeof key !== "string") throw new BadRequestException("无效的信件人员筛选。")
  if (key === "platform" && box === "inbox") return { kind: "platform_broadcast" }
  const match = /^(user|organization):([^\s:]{1,160})$/u.exec(key)
  if (!match || (box === "inbox" && match[1] !== "user")) throw new BadRequestException("无效的信件人员筛选。")
  const [, kind, id] = match
  if (box === "inbox") return { senderId: id }
  const address = kind === "user" ? { kind, userId: id } : { kind, organizationId: id }
  const addresses: Prisma.MailMessageWhereInput[] = [
    { addressSnapshot: { path: ["to"], array_contains: [address] } },
    { addressSnapshot: { path: ["cc"], array_contains: [address] } },
  ]
  // 只有无地址快照的旧信允许从实际收件记录回退；组织信绝不展开成员。
  if (kind === "user") addresses.push({ addressSnapshot: { equals: Prisma.DbNull }, recipients: { some: { userId: id } } })
  return { AND: [{ OR: addresses }] }
}

/** 在数据库内聚合完整信箱，仅返回联系人，不读取正文或展开历史组织成员。 */
export function mailContactsQuery(userId: string, box: MailBox): Prisma.Sql {
  const source = box === "inbox" ? Prisma.sql`
    SELECT m.id AS "messageId", m."sentAt",
      CASE WHEN m.kind = 'platform_broadcast' THEN 'platform' ELSE 'user:' || m."senderId" END AS key,
      CASE WHEN m.kind = 'platform_broadcast' THEN 'platform' ELSE 'user' END AS kind,
      CASE WHEN m.kind = 'platform_broadcast' THEN 'Synapse' ELSE COALESCE(NULLIF(u.nickname, ''), u.handle, u.id) END AS name,
      CASE WHEN m.kind = 'platform_broadcast' THEN NULL ELSE u.handle END AS handle,
      NULL::text AS "teamName", CASE WHEN r."readAt" IS NULL THEN 1 ELSE 0 END AS unread
    FROM "MailRecipient" r JOIN "MailMessage" m ON m.id = r."messageId"
    LEFT JOIN "User" u ON u.id = m."senderId"
    WHERE r."userId" = ${userId} AND r."deletedAt" IS NULL
  ` : Prisma.sql`
    SELECT m.id AS "messageId", m."sentAt",
      CASE WHEN a->>'kind' = 'user' THEN 'user:' || (a->>'userId') ELSE 'organization:' || (a->>'organizationId') END AS key,
      a->>'kind' AS kind, a->>'name' AS name, NULL::text AS handle,
      CASE WHEN a->>'kind' = 'organization' THEN m."teamNameSnapshot" ELSE NULL END AS "teamName", 0 AS unread
    FROM "MailMessage" m
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m."addressSnapshot"->'to', '[]'::jsonb) || COALESCE(m."addressSnapshot"->'cc', '[]'::jsonb)) a
    WHERE m."senderId" = ${userId} AND m."senderDeletedAt" IS NULL AND a->>'kind' IN ('user', 'organization')
    UNION ALL
    SELECT m.id, m."sentAt", 'user:' || r."userId", 'user',
      COALESCE(NULLIF(u.nickname, ''), u.handle, u.id), u.handle, NULL::text, 0
    FROM "MailMessage" m JOIN "MailRecipient" r ON r."messageId" = m.id JOIN "User" u ON u.id = r."userId"
    WHERE m."senderId" = ${userId} AND m."senderDeletedAt" IS NULL AND m."addressSnapshot" IS NULL
  `
  return Prisma.sql`
    WITH source AS (${source}), ranked AS (
      SELECT key, kind, name, handle, "teamName", "sentAt" AS "lastSentAt",
        (SUM(unread) OVER (PARTITION BY key))::integer AS unread,
        ROW_NUMBER() OVER (PARTITION BY key ORDER BY "sentAt" DESC, "messageId" DESC) AS position
      FROM source WHERE key IS NOT NULL
    )
    SELECT key, kind, name, handle, "teamName", unread, "lastSentAt"
    FROM ranked WHERE position = 1 ORDER BY "lastSentAt" DESC, key ASC
  `
}
