import type {
  DriveFileVersionDto,
  DriveFileVersionSource,
} from '@synapse/shared'

export type ChangeHistoryViewMode = 'single' | 'range' | 'feed'
export type ChangeHistoryTimePreset = 'all' | '7d' | '14d' | '30d' | 'custom'
export type ChangeHistorySourceFilter = 'all' | DriveFileVersionSource
export type ChangeHistoryDiffStyle = 'unified' | 'split'
export type ChangeHistoryFeedOrder = 'desc' | 'asc'

export const EMPTY_BASE_VERSION_ID = '__empty__'

export interface ChangeHistoryFilterState {
  readonly preset: ChangeHistoryTimePreset
  readonly dateFrom: string
  readonly dateTo: string
  readonly source: ChangeHistorySourceFilter
}

export function toLocalCalendarDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function shiftLocalCalendarDays(baseDate: Date, deltaDays: number): string {
  const shifted = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + deltaDays)
  return toLocalCalendarDate(shifted)
}

export function resolveDateBounds(
  filter: Pick<ChangeHistoryFilterState, 'preset' | 'dateFrom' | 'dateTo'>,
  now: Date = new Date()
): { readonly from: string | null; readonly to: string | null } {
  const today = toLocalCalendarDate(now)
  if (filter.preset === '7d') return { from: shiftLocalCalendarDays(now, -7), to: today }
  if (filter.preset === '14d') return { from: shiftLocalCalendarDays(now, -14), to: today }
  if (filter.preset === '30d') return { from: shiftLocalCalendarDays(now, -30), to: today }
  if (filter.preset === 'custom') {
    const from = filter.dateFrom.trim() || null
    const to = filter.dateTo.trim() || null
    if (from && to && from > to) return { from: to, to: from }
    return { from, to }
  }
  return { from: null, to: null }
}

export function filterChangeHistoryVersions(
  versionsDesc: readonly DriveFileVersionDto[],
  filter: ChangeHistoryFilterState,
  now: Date = new Date()
): DriveFileVersionDto[] {
  const { from, to } = resolveDateBounds(filter, now)
  return versionsDesc.filter((version) => {
    if (filter.source !== 'all' && version.source !== filter.source) return false
    if (from || to) {
      const versionDate = toLocalCalendarDate(version.createdAt)
      if (!versionDate) return false
      if (from && versionDate < from) return false
      if (to && versionDate > to) return false
    }
    return true
  })
}

export function findPreviousComparableVersion(
  allVersionsDesc: readonly DriveFileVersionDto[],
  versionId: string
): DriveFileVersionDto | null {
  const index = allVersionsDesc.findIndex((entry) => entry.id === versionId)
  if (index === -1) return null
  for (let cursor = index + 1; cursor < allVersionsDesc.length; cursor += 1) {
    const candidate = allVersionsDesc[cursor]
    if (candidate && !candidate.deletePending) return candidate
  }
  return null
}

export function resolveRangeCumulativeBounds(
  allVersionsDesc: readonly DriveFileVersionDto[],
  filteredVersionsDesc: readonly DriveFileVersionDto[]
): { readonly baseVersionId: string; readonly targetVersionId: string } | null {
  const comparable = filteredVersionsDesc.filter((version) => !version.deletePending)
  if (comparable.length === 0) return null
  const latest = comparable[0]!
  const earliest = comparable[comparable.length - 1]!
  const preceding = findPreviousComparableVersion(allVersionsDesc, earliest.id)
  return {
    baseVersionId: preceding ? preceding.id : EMPTY_BASE_VERSION_ID,
    targetVersionId: latest.id,
  }
}

export function driveChangeSourceLabel(source: DriveFileVersionSource): string {
  const labels: Record<DriveFileVersionSource, string> = {
    upload: '上传',
    online_edit: '编辑',
    collaboration: '协同编辑',
    restore: '恢复',
  }
  return labels[source]
}
