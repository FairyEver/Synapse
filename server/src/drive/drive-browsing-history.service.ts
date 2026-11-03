import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import type { Request } from "express"
import { createHash } from "node:crypto"
import { normalizePublicAppUrl, type DriveBrowsingHistoryEntryDto, type DriveBrowsingHistoryKind, type DriveBrowsingHistoryListInput, type DriveBrowsingHistoryPageDto } from "@synapse/shared"
import { driveSearchFileType, driveSearchTerms, normalizeDriveSearchText } from "@synapse/shared/drive-search"
import { PrismaService } from "../prisma/prisma.service"
import { DriveService } from "./drive.service"

const authorSelect = { handle: true, nickname: true, email: true } as const
type HistoryAuthor = { readonly handle: string; readonly nickname: string; readonly email: string }
type HistorySnapshot = { readonly title: string; readonly kind: DriveBrowsingHistoryKind; readonly path: string; readonly author: HistoryAuthor }
type HistoryCursor = { readonly binding: string; readonly visitedAt: string; readonly id: string }
type DailyHistoryRow = {
  readonly id: string
  readonly title: string
  readonly authorHandle: string
  readonly kind: DriveBrowsingHistoryKind
  readonly path: string
  readonly visitedAt: Date
  readonly visitCount: bigint
}

/** Fetch metadata is intentionally required: crawlers/MCP, iframes and resource requests are not visits. */
export function isDriveHistoryNavigation(request: Pick<Request, "method" | "headers" | "query">): boolean {
  return request.method === "GET"
    && request.headers["sec-fetch-mode"] === "navigate"
    && request.headers["sec-fetch-dest"] === "document"
    && request.query.childrenOffset === undefined
    && request.query.childrenLimit === undefined
}

@Injectable()
export class DriveBrowsingHistoryService {
  private readonly logger = new Logger(DriveBrowsingHistoryService.name)

  constructor(private readonly prisma: PrismaService, private readonly drive: DriveService) {}

  async list(viewerId: string, input: DriveBrowsingHistoryListInput = {}, requestedTimeZone?: string): Promise<DriveBrowsingHistoryPageDto> {
    const timeZone = resolveHistoryTimeZone(requestedTimeZone)
    const terms = driveSearchTerms(normalizeHistorySearchQuery(input.query))
    const binding = createHash("sha256").update(JSON.stringify([viewerId, terms, input.kind ?? null, timeZone])).digest("hex")
    const cursor = input.cursor ? parseCursor(input.cursor, binding) : null
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))
    const filters = [
      Prisma.sql`position = 1`,
      ...(input.kind ? [Prisma.sql`"kind" = ${input.kind}`] : []),
      ...terms.map((term) => Prisma.sql`strpos("searchIndex", ${term}) > 0`),
      ...(cursor ? [Prisma.sql`("visitedAt", "id") < (${new Date(cursor.visitedAt).toISOString()}::timestamp, ${cursor.id})`] : []),
    ]
    // Count the whole day before filtering or paging its latest snapshot.
    const rows = await this.prisma.$queryRaw<DailyHistoryRow[]>(Prisma.sql`
      WITH daily AS (
        SELECT "id", "title", "authorHandle", "kind", "path", "visitedAt", "searchIndex",
          count(*) OVER visits AS "visitCount",
          row_number() OVER visits AS position
        FROM "DriveBrowsingHistory"
        WHERE "viewerId" = ${viewerId} AND NOT "cleared"
        WINDOW visits AS (
          PARTITION BY "path", timezone(${timeZone}::text, "visitedAt" AT TIME ZONE 'UTC')::date
          ORDER BY "visitedAt" DESC, "id" DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        )
      )
      SELECT "id", "title", "authorHandle", "kind", "path", "visitedAt", "visitCount"
      FROM daily
      WHERE ${Prisma.join(filters, " AND ")}
      ORDER BY "visitedAt" DESC, "id" DESC
      LIMIT ${limit + 1}
    `)
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      items: page.map((row): DriveBrowsingHistoryEntryDto => ({
        id: row.id, title: row.title, author: row.authorHandle, kind: row.kind,
        url: `${publicAppUrl()}${row.path}`, visitedAt: row.visitedAt.toISOString(), visitCount: Number(row.visitCount),
      })),
      nextCursor: rows.length > limit && last
        ? Buffer.from(JSON.stringify({ binding, visitedAt: last.visitedAt.toISOString(), id: last.id })).toString("base64url")
        : null,
    }
  }

  async clear(viewerId: string): Promise<{ readonly ok: true }> {
    // Keep only the opaque visit receipt: a delayed retry must not restore erased history.
    await this.prisma.driveBrowsingHistory.updateMany({
      where: { viewerId, cleared: false },
      data: { cleared: true, title: "", path: "", authorHandle: "", searchIndex: "", kind: "other", visitedAt: new Date() },
    })
    return { ok: true }
  }

  async recordShare(viewerId: string, visitId: string, input: { readonly shareId: string; readonly itemId?: string; readonly cookie?: string }): Promise<void> {
    // This existing resolver checks the current share, password cookie and item containment without reading document contents.
    const { item } = await this.drive.resolveShareAnnotationAccess({ ...input, actorUserId: viewerId })
    const author = await this.prisma.user.findUnique({ where: { id: item.userId }, select: authorSelect })
    if (!author) return
    const path = `/share/${encodeURIComponent(input.shareId)}${input.itemId ? `/items/${encodeURIComponent(item.id)}` : ""}`
    await this.save(viewerId, visitId, { title: item.name, kind: historyKind(item), path, author })
  }

  /** Called only after the controller has successfully served the authorized site asset. */
  async recordSite(viewerId: string, visitId: string, siteId: string, relativePath: string): Promise<void> {
    const site = await this.prisma.driveSite.findUnique({ where: { siteId }, select: { name: true, user: { select: authorSelect } } })
    if (!site) return
    await this.save(viewerId, visitId, {
      title: site.name, kind: "web", author: site.user,
      path: `/sites/${encodeURIComponent(siteId)}/${relativePath.split("/").map(encodeURIComponent).join("/")}`,
    })
  }

  /** Called only after the public asset response has completed successfully. */
  async recordPublicAsset(viewerId: string, visitId: string, assetId: string): Promise<void> {
    const asset = await this.prisma.publicAsset.findUnique({ where: { assetId }, select: { name: true, mimeType: true, user: { select: authorSelect } } })
    if (!asset) return
    await this.save(viewerId, visitId, {
      title: asset.name, kind: historyKind({ ...asset, type: "file" }), author: asset.user,
      path: `/files/${encodeURIComponent(assetId)}`,
    })
  }

  private async save(viewerId: string, visitId: string, snapshot: HistorySnapshot): Promise<void> {
    try {
      // Keep each independent event so later visits cannot erase earlier days or their receipts.
      const snapshotData = {
        visitId, title: snapshot.title, kind: snapshot.kind, path: snapshot.path,
        authorHandle: snapshot.author.handle,
        searchIndex: normalizeDriveSearchText([snapshot.title, `${publicAppUrl()}${snapshot.path}`, snapshot.author.handle, snapshot.author.nickname, snapshot.author.email].join("\n")),
      }
      await this.prisma.driveBrowsingHistory.createMany({ data: { viewerId, ...snapshotData }, skipDuplicates: true })
    } catch (error) {
      // Driver errors can include parameters. Never log the error message or private search snapshot.
      this.logger.warn({ message: "Drive browsing history persistence failed", errorName: error instanceof Error ? error.name : "UnknownError" })
      throw new ServiceUnavailableException("浏览历史暂时无法保存，请稍后重试。")
    }
  }
}

function resolveHistoryTimeZone(value = "UTC"): string {
  if (value.length <= 100 && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/u.test(value)) {
    try {
      return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  }
  throw new BadRequestException("浏览历史时区无效。")
}

/** Recognized first-party links address the same visit without secret queries or share reader suffixes. */
function normalizeHistorySearchQuery(query = ""): string {
  const candidate = normalizeDriveSearchText(query).trim()
  if (!/^https?:\/\//u.test(candidate) || /\s/u.test(candidate)) return query
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return query
  }
  const configured = new URL(publicAppUrl())
  if (url.origin !== configured.origin || url.username || url.password) return query
  const basePath = configured.pathname.replace(/\/$/u, "")
  if (basePath && !url.pathname.startsWith(`${basePath}/`)) return query
  const path = url.pathname.slice(basePath.length)
  const share = /^(\/share\/[^/]+(?:\/items\/[^/]+)?)(?:\/(?:reader|render|download))?\/?$/u.exec(path)
  if (share) return `${configured.origin}${basePath}${share[1]}`
  if (/^\/sites\/[^/]+(?:\/.*)?$/u.test(path)) return `${configured.origin}${basePath}${path}`
  if (/^\/files\/[^/]+\/?$/u.test(path)) return `${configured.origin}${basePath}${path.replace(/\/$/u, "")}`
  return query
}

function historyKind(item: { readonly type: string; readonly name: string; readonly mimeType: string | null }): DriveBrowsingHistoryKind {
  if (item.type === "folder") return "folder"
  if (item.mimeType?.split(";", 1)[0]?.trim().toLowerCase() === "text/html" || /\.html?$/iu.test(item.name)) return "web"
  const kind = driveSearchFileType({ ...item, type: "file" })
  return kind === "folder" || kind === "document" ? kind : "other"
}

function publicAppUrl(): string {
  const url = normalizePublicAppUrl(process.env.APP_PUBLIC_URL ?? "")
  if (!url) throw new Error("APP_PUBLIC_URL is required for browsing history")
  return url
}

function parseCursor(value: string, binding: string): HistoryCursor {
  try {
    if (value.length > 1024) throw new Error("cursor too large")
    const cursor: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (!cursor || typeof cursor !== "object") throw new Error("invalid cursor")
    const row = cursor as Record<string, unknown>
    if (row.binding !== binding || typeof row.id !== "string" || !row.id || row.id.length > 128
      || typeof row.visitedAt !== "string" || !Number.isFinite(Date.parse(row.visitedAt))) throw new Error("invalid cursor")
    return row as HistoryCursor
  } catch {
    throw new BadRequestException("浏览历史游标无效，请重新查询。")
  }
}
