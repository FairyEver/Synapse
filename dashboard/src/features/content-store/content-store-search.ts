import type { ContentStoreType } from '@synapse/shared'
import type { ContentStoreListQuery } from '@/lib/api'
import { DEFAULT_DASHBOARD_PAGE_SIZE } from '@/components/data-table'

const validTypes = new Set<ContentStoreType>(['skill', 'rule', 'prompt'])
const validSortBy = new Set(['createdAt', 'updatedAt', 'installCount'])
const validSortOrder = new Set(['asc', 'desc'])

type RawContentStoreSearch = {
  page?: unknown
  pageSize?: unknown
  sortBy?: unknown
  sortOrder?: unknown
  type?: unknown
  query?: unknown
}

export function parseContentStoreSearch(search: RawContentStoreSearch) {
  return {
    page: parsePositiveInteger(search.page, 1),
    pageSize: parsePositiveInteger(
      search.pageSize,
      DEFAULT_DASHBOARD_PAGE_SIZE
    ),
    sortBy:
      typeof search.sortBy === 'string' && validSortBy.has(search.sortBy)
        ? (search.sortBy as ContentStoreListQuery['sortBy'])
        : undefined,
    sortOrder:
      typeof search.sortOrder === 'string' && validSortOrder.has(search.sortOrder)
        ? (search.sortOrder as ContentStoreListQuery['sortOrder'])
        : undefined,
    type:
      typeof search.type === 'string' && validTypes.has(search.type as ContentStoreType)
        ? (search.type as ContentStoreType)
        : undefined,
    query: typeof search.query === 'string' ? search.query : '',
  }
}

export function buildContentStoreSearch(search: RawContentStoreSearch) {
  const parsed = parseContentStoreSearch(search)
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    sortBy: parsed.sortBy,
    sortOrder: parsed.sortOrder,
    type: parsed.type,
    query: parsed.query.trim() || undefined,
  } satisfies ContentStoreListQuery
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
