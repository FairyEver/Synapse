import type { DriveItemDto } from "./drive.js" with { "resolution-mode": "import" }

export const DRIVE_SEARCH_FILE_TYPES = ["folder", "document", "image", "archive", "other"] as const
export const DRIVE_SEARCH_PAGE_SIZE = 100
export const DRIVE_SEARCH_SORTS = ["relevance", "modified", "name"] as const
export const DRIVE_SEARCH_SHARE_STATUSES = ["shared", "private"] as const
export type DriveSearchFileType = typeof DRIVE_SEARCH_FILE_TYPES[number]
export interface DriveSearchFilters {
  readonly query?: string
  readonly fileType?: DriveSearchFileType
  readonly updatedAfter?: string
  readonly shareStatus?: typeof DRIVE_SEARCH_SHARE_STATUSES[number]
  readonly sort?: typeof DRIVE_SEARCH_SORTS[number]
}
export const DRIVE_SEARCH_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "svg", "bmp", "heic", "tiff"] as const
export const DRIVE_SEARCH_DOCUMENT_EXTENSIONS = ["md", "mdx", "markdown", "txt", "html", "htm", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "rtf", "json", "xml", "odt", "ods", "odp"] as const
export const DRIVE_SEARCH_ARCHIVE_EXTENSIONS = ["zip", "7z", "rar", "gz", "gzip", "tar", "bz2", "xz", "tgz"] as const
export const DRIVE_SEARCH_DOCUMENT_MIMES = ["application/pdf", "application/json", "application/xml", "application/msword", "application/rtf"] as const
export const DRIVE_SEARCH_ARCHIVE_MIMES = ["application/zip", "application/x-7z-compressed", "application/vnd.rar", "application/gzip", "application/x-tar", "application/x-rar-compressed"] as const

export function normalizeDriveSearchText(value: string): string { return value.normalize("NFKC").toLowerCase() }
export function driveSearchTerms(query = ""): string[] { return normalizeDriveSearchText(query).trim().split(/\s+/u).filter(Boolean) }

function validSearchTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value)
  if (!match) return false
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day >= 1 && day <= days && Number.isFinite(Date.parse(value))
}

/** 所有入口使用相同的有限条件；未知条件由各入口的严格 schema 拒绝。 */
export function parseDriveSearchFilters(input: unknown): DriveSearchFilters {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("搜索条件无效。")
  const value = input as Record<string, unknown>
  const result: { query?: string; fileType?: DriveSearchFileType; updatedAfter?: string; shareStatus?: DriveSearchFilters["shareStatus"]; sort?: DriveSearchFilters["sort"] } = {}
  if (value.query !== undefined) {
    if (typeof value.query !== "string" || value.query.length > 200 || value.query.includes("\0")) throw new TypeError("搜索关键词不能超过 200 个字符。")
    result.query = normalizeDriveSearchText(value.query).trim()
  }
  for (const [key, choices] of [["fileType", DRIVE_SEARCH_FILE_TYPES], ["shareStatus", DRIVE_SEARCH_SHARE_STATUSES], ["sort", DRIVE_SEARCH_SORTS]] as const) {
    const candidate = value[key]
    if (candidate === undefined) continue
    if (typeof candidate !== "string" || !(choices as readonly string[]).includes(candidate)) throw new TypeError("搜索筛选无效。")
    Object.assign(result, { [key]: candidate })
  }
  if (value.updatedAfter !== undefined) {
    if (typeof value.updatedAfter !== "string" || value.updatedAfter.length > 64 || !validSearchTimestamp(value.updatedAfter)) throw new TypeError("搜索时间无效。")
    result.updatedAfter = new Date(value.updatedAfter).toISOString()
  }
  return result
}

export function driveSearchFileType(item: Pick<DriveItemDto, "type" | "name" | "mimeType">): DriveSearchFileType {
  if (item.type === "folder") return "folder"
  const extension = normalizeDriveSearchText(item.name).split(".").at(-1) ?? ""
  const mime = item.mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  const includes = (values: readonly string[]) => values.includes(extension)
  if (mime.startsWith("image/") || includes(DRIVE_SEARCH_IMAGE_EXTENSIONS)) return "image"
  if (mime.startsWith("text/") || mime.startsWith("application/vnd.openxmlformats-") || mime.startsWith("application/vnd.ms-") || (DRIVE_SEARCH_DOCUMENT_MIMES as readonly string[]).includes(mime) || includes(DRIVE_SEARCH_DOCUMENT_EXTENSIONS)) return "document"
  if ((DRIVE_SEARCH_ARCHIVE_MIMES as readonly string[]).includes(mime) || includes(DRIVE_SEARCH_ARCHIVE_EXTENSIONS)) return "archive"
  return "other"
}

export function filterDriveSearchItems<T extends DriveItemDto>(items: readonly T[], filters: DriveSearchFilters): T[] {
  const terms = driveSearchTerms(filters.query)
  const results = items.filter(item => terms.every(term => normalizeDriveSearchText(item.name).includes(term))
    && (!filters.fileType || driveSearchFileType(item) === filters.fileType)
    && (!filters.updatedAfter || Date.parse(item.updatedAt) >= Date.parse(filters.updatedAfter))
    && (!filters.shareStatus || item.shared === (filters.shareStatus === "shared")))
  if (!Object.keys(filters).length) return results
  return results.sort((a, b) => {
    const left = normalizeDriveSearchText(a.name), right = normalizeDriveSearchText(b.name)
    if (filters.sort === "name") return left.localeCompare(right) || a.id.localeCompare(b.id)
    if ((!filters.sort || filters.sort === "relevance") && terms.length) {
      const rank = (name: string) => name === filters.query ? 0 : name.startsWith(terms[0]) ? 1 : 2
      const difference = rank(left) - rank(right)
      if (difference) return difference
    }
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  })
}
