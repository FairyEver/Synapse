import { Prisma } from "@prisma/client"
import { DRIVE_SEARCH_ARCHIVE_EXTENSIONS, DRIVE_SEARCH_ARCHIVE_MIMES, DRIVE_SEARCH_DOCUMENT_EXTENSIONS, DRIVE_SEARCH_DOCUMENT_MIMES, DRIVE_SEARCH_IMAGE_EXTENSIONS, driveSearchTerms, type DriveSearchFilters } from "@synapse/shared"

/** 仅组合参数化 SQL；过滤和排序都作用于完整递归结果，不能在分页后匹配。 */
export function driveSearchQuery(filters: DriveSearchFilters) {
  const terms = driveSearchTerms(filters.query)
  const name = Prisma.sql`lower(normalize(tree.name, NFKC))`
  const extension = Prisma.sql`substring(${name} from '[^.]+$')`
  const mime = Prisma.sql`lower(btrim(split_part(coalesce(tree."mimeType", ''), ';', 1)))`
  const type = Prisma.sql`CASE
    WHEN tree.type = 'folder' THEN 'folder'
    WHEN ${mime} LIKE 'image/%' OR ${extension} IN (${Prisma.join([...DRIVE_SEARCH_IMAGE_EXTENSIONS])}) THEN 'image'
    WHEN ${mime} LIKE 'text/%' OR ${mime} LIKE 'application/vnd.openxmlformats-%' OR ${mime} LIKE 'application/vnd.ms-%'
      OR ${mime} IN (${Prisma.join([...DRIVE_SEARCH_DOCUMENT_MIMES])}) OR ${extension} IN (${Prisma.join([...DRIVE_SEARCH_DOCUMENT_EXTENSIONS])}) THEN 'document'
    WHEN ${mime} IN (${Prisma.join([...DRIVE_SEARCH_ARCHIVE_MIMES])}) OR ${extension} IN (${Prisma.join([...DRIVE_SEARCH_ARCHIVE_EXTENSIONS])}) THEN 'archive'
    ELSE 'other' END`
  const conditions: Prisma.Sql[] = terms.map(term => Prisma.sql`strpos(${name}, ${term}) > 0`)
  if (filters.fileType) conditions.push(Prisma.sql`${type} = ${filters.fileType}`)
  if (filters.updatedAfter) conditions.push(Prisma.sql`tree."updatedAt" >= ${new Date(filters.updatedAfter)}`)
  if (filters.shareStatus) conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "DriveShare" ds WHERE ds."itemId" = tree.id AND ds.enabled = true
      AND (ds."expiresAt" IS NULL OR ds."expiresAt" > NOW())
  ) = ${filters.shareStatus === "shared"}`)
  let order = Prisma.sql`tree.sort_path`
  if (Object.keys(filters).length) {
    order = filters.sort === "name" ? Prisma.sql`${name} ASC, tree.id ASC` : Prisma.sql`tree."updatedAt" DESC, tree.id ASC`
    if ((!filters.sort || filters.sort === "relevance") && terms.length) {
      order = Prisma.sql`CASE WHEN ${name} = ${filters.query} THEN 0 WHEN starts_with(${name}, ${terms[0]}) THEN 1 ELSE 2 END, tree."updatedAt" DESC, tree.id ASC`
    }
  }
  return { where: conditions.length ? Prisma.join(conditions, " AND ") : Prisma.sql`true`, order }
}
