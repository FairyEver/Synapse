import { Prisma, type CloudTable } from "@prisma/client"
import { dailySummarySchema, type CloudDailySummary } from "./cloud-table-contract"
import { fail } from "./cloud-table-validation"

type Tx = Prisma.TransactionClient
type SummaryTable = Pick<CloudTable, "id" | "ownerId" | "anonymous">
const maxGroups = 100

export function splitCloudTableAccess(value: Prisma.JsonValue) {
  const { dailySummary, ...anonymous } = value as { dailySummary?: unknown } & Partial<Record<"read" | "create" | "update" | "delete", boolean>>
  return { dailySummary, anonymous }
}

async function summaryDate(tx: Tx, table: SummaryTable, settings: CloudDailySummary, publishing: boolean) {
  const invalid = () => publishing
    ? fail("INVALID_DAILY_SUMMARY", "请选择有效的日期、菜品引用和布尔字段，以及同一表主的公开目录和时区。")
    : fail("DAILY_SUMMARY_UNAVAILABLE", "今日汇总未开放。", 403)
  if (settings.catalogTableId === table.id || !/^[A-Za-z]/u.test(settings.timeZone)) return invalid()
  let date: string
  try {
    date = new Intl.DateTimeFormat("sv-SE", { timeZone: settings.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format()
  } catch (error) {
    if (error instanceof RangeError) return invalid()
    throw error
  }
  // Keep catalog visibility stable until the summary transaction finishes.
  const [catalog] = await tx.$queryRaw<{ anonymous: Prisma.JsonValue }[]>`
    SELECT "anonymous" FROM "CloudTable" WHERE "id" = ${settings.catalogTableId}
      AND "ownerId" = ${table.ownerId} AND "deletedAt" IS NULL FOR SHARE`
  if (!catalog || splitCloudTableAccess(catalog.anonymous).anonymous.read !== true) return invalid()
  const fieldTypes = [
    { tableId: table.id, key: settings.dateField, type: "date" },
    { tableId: table.id, key: settings.selectionField, type: "text" },
    { tableId: table.id, key: settings.flagField, type: "boolean" },
    { tableId: settings.catalogTableId, key: settings.catalogLabelField, type: "text" },
  ]
  const fields = await tx.cloudTableField.findMany({
    where: { archivedAt: null, OR: fieldTypes.map(({ tableId, key }) => ({ tableId, key })) },
    select: { tableId: true, key: true, definition: true }, take: 4,
  })
  if (!fieldTypes.every(expected => fields.some(field => field.tableId === expected.tableId && field.key === expected.key && (field.definition as { type: string }).type === expected.type))) return invalid()
  return date
}

export async function validateDailySummary(tx: Tx, table: SummaryTable, settings: CloudDailySummary) {
  await summaryDate(tx, table, settings, true)
}

export async function readDailySummary(tx: Tx, table: SummaryTable) {
  const settings = dailySummarySchema.safeParse(splitCloudTableAccess(table.anonymous).dailySummary)
  if (!settings.success) fail("DAILY_SUMMARY_UNAVAILABLE", "今日汇总未开放。", 403)
  const { dateField, selectionField, flagField, catalogTableId, catalogLabelField } = settings.data
  const date = await summaryDate(tx, table, settings.data, false)
  const rows = await tx.$queryRaw<{ label: string | null; selections: bigint; flagged: bigint }[]>`
    WITH grouped AS (
      SELECT r."values" ->> ${selectionField} AS reference, COUNT(*) AS selections,
        COUNT(*) FILTER (WHERE r."values" -> ${flagField} = 'true'::jsonb) AS flagged
      FROM "CloudTableRecord" r
      WHERE r."tableId" = ${table.id} AND r."deletedAt" IS NULL
        AND r."values" @> ${JSON.stringify({ [dateField]: date })}::jsonb
      GROUP BY 1
    ), catalog AS (
      SELECT "id", BTRIM("values" ->> ${catalogLabelField}) AS label
      FROM "CloudTableRecord" WHERE "tableId" = ${catalogTableId} AND "deletedAt" IS NULL
        AND LENGTH(BTRIM("values" ->> ${catalogLabelField})) BETWEEN 1 AND 100
    ), ranked AS (
      SELECT c.label, COALESCE(SUM(g.selections), 0)::bigint AS selections,
        COALESCE(SUM(g.flagged), 0)::bigint AS flagged
      FROM catalog c LEFT JOIN grouped g ON g.reference = c."id"
      GROUP BY c.label
      ORDER BY selections DESC, flagged DESC, label ASC LIMIT ${maxGroups + 1}
    )
    SELECT label, selections, flagged FROM ranked
    UNION ALL
    SELECT NULL, COALESCE(SUM(g.selections), 0)::bigint, COALESCE(SUM(g.flagged), 0)::bigint
    FROM grouped g WHERE NOT EXISTS (SELECT 1 FROM catalog c WHERE c."id" = g.reference)
    ORDER BY selections DESC, flagged DESC, label ASC`
  const counts = (row: (typeof rows)[number]) => {
    if (row.selections > BigInt(Number.MAX_SAFE_INTEGER)) fail("COUNT_TOO_LARGE", "汇总数量超出安全整数范围。")
    return { selections: Number(row.selections), flagged: Number(row.flagged) }
  }
  const groups = rows.flatMap(row => row.label === null ? [] : [{ label: row.label, ...counts(row) }])
  const other = rows.find(row => row.label === null)
  return { date, data: groups.slice(0, maxGroups), other: other ? counts(other) : { selections: 0, flagged: 0 }, hasMore: groups.length > maxGroups }
}
