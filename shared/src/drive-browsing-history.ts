/** 本人浏览历史的筛选类型，不改变文件预览能力目录。 */
export type DriveBrowsingHistoryKind = "web" | "document" | "folder" | "other"

export interface DriveBrowsingHistoryListInput {
  readonly query?: string
  readonly kind?: DriveBrowsingHistoryKind
  readonly cursor?: string
  readonly limit?: number
}

export interface DriveBrowsingHistoryEntryDto {
  readonly id: string
  readonly title: string
  readonly author: string
  readonly kind: DriveBrowsingHistoryKind
  readonly url: string
  readonly visitedAt: string
}

export interface DriveBrowsingHistoryPageDto {
  readonly items: readonly DriveBrowsingHistoryEntryDto[]
  readonly nextCursor: string | null
}
