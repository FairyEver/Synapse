export type FileType = "all" | "folder" | "document" | "image" | "archive" | "other"
export type Scope = "all" | "folder"
export type Sort = "relevance" | "modified" | "name"
export type Filters = { type: FileType; days: string; shared: string }
export type Item = {
  id: string; parent: string | null; name: string; type: Exclude<FileType, "all">;
  modified: string; size: string; shared?: boolean; body?: string
}
// 固定演示日期，时间筛选不因原型打开日期而改变。
export const TODAY = Date.parse("2026-10-20T16:00:00+08:00")
export const PAGE_SIZE = 100
export const EMPTY_FILTERS: Filters = { type: "all", days: "all", shared: "all" }
export const TYPE_LABELS: Record<FileType, string> = {
  all: "全部类型", folder: "文件夹", document: "文档", image: "图片", archive: "压缩包", other: "其他文件",
}
export const ITEMS: Item[] = [
  { id: "skill", parent: null, name: "技能列表技能模式字段接口改造交接.md", type: "document", modified: "2026-10-20", size: "18 KB", shared: true },
  { id: "message", parent: null, name: "消息失效处理配置-产品设计评估报告-2026-10-16.md", type: "document", modified: "2026-10-16", size: "32 KB", shared: true },
  { id: "ds", parent: null, name: "1 ds的设计.md", type: "document", modified: "2026-10-16", size: "12 KB", shared: true },
  { id: "codex", parent: null, name: "1 codex的设计.md", type: "document", modified: "2026-10-16", size: "24 KB", shared: true },
  { id: "gitee", parent: null, name: "Gitee缺陷分析报告-2026Q3.html", type: "document", modified: "2026-10-15", size: "86 KB", shared: true },
  { id: "home", parent: null, name: "不同用户不同首页-三端实施阻塞评估-2026-10-13.md", type: "document", modified: "2026-10-13", size: "28 KB", shared: true },
  { id: "testkit", parent: null, name: "TestKit 产品介绍.html", type: "document", modified: "2026-10-10", size: "136 KB", shared: true },
  { id: "sync", parent: null, name: "云盘同步重设计.html", type: "document", modified: "2026-09-30", size: "94 KB", shared: true },
  { id: "guide", parent: null, name: "gtr-AI使用指南.md", type: "document", modified: "2026-09-30", size: "16 KB" },
  { id: "contract", parent: null, name: "合同审批_App端无法提交_代码分析.md", type: "document", modified: "2026-09-30", size: "42 KB", shared: true },
  { id: "branch", parent: null, name: "branch-4.6.3.42-analysis.md", type: "document", modified: "2026-09-30", size: "15 KB" },
  { id: "portal-execution", parent: null, name: "2026-09-28-portal-form-footer-unification-execution.md", type: "document", modified: "2026-09-28", size: "18 KB", shared: true },
  { id: "trackpad", parent: null, name: "macOS触摸板双指横扫返回-测试结论与实施方案.md", type: "document", modified: "2026-09-28", size: "21 KB", shared: true },
  { id: "portal-analysis", parent: null, name: "2026-09-28-portal-form-footer-unification-analysis.md", type: "document", modified: "2026-09-28", size: "16 KB", shared: true },
  { id: "mail", parent: null, name: "Synapse-站内信产品方案.html", type: "document", modified: "2026-09-27", size: "68 KB", shared: true },
  { id: "reminder", parent: null, name: "提醒触发清单.md", type: "document", modified: "2026-09-26", size: "8 KB" },
  { id: "synapse", parent: "projects", name: "Synapse", type: "folder", modified: "2026-10-20", size: "—" },
  { id: "erp", parent: "projects", name: "ERP", type: "folder", modified: "2026-10-19", size: "—" },
  { id: "review", parent: "projects", name: "产品设计评审记录.md", type: "document", modified: "2026-10-19", size: "14 KB" },
  { id: "search", parent: "synapse", name: "云盘文件搜索设计.md", type: "document", modified: "2026-10-20", size: "21 KB", body: "云盘文件搜索设计\n\n目标\n通过文件名或扩展名，在个人云盘中查找文件和文件夹。\n\n搜索范围\n默认搜索整个云盘，也可缩小到当前文件夹及其子文件夹。\n\n搜索结果\n保留文件名、位置、更新时间和分享状态。点击文件可预览，定位后可返回原搜索结果。\n\n筛选\n文件类型、更新时间、分享状态可组合使用。" },
  { id: "spec", parent: "synapse", name: "需求说明.md", type: "document", modified: "2026-10-19", size: "18 KB" },
  { id: "assets", parent: "synapse", name: "设计素材", type: "folder", modified: "2026-10-18", size: "—" },
  { id: "shot", parent: "assets", name: "云盘搜索界面.png", type: "image", modified: "2026-10-20", size: "428 KB" },
  { id: "layout", parent: "assets", name: "云盘列表设计.png", type: "image", modified: "2026-10-18", size: "312 KB" },
  { id: "logo", parent: "assets", name: "Synapse.svg", type: "image", modified: "2026-10-10", size: "6 KB" },
  { id: "erp-design", parent: "erp", name: "云盘文件搜索设计.md", type: "document", modified: "2026-10-17", size: "16 KB", shared: true },
  { id: "erp-report", parent: "erp", name: "合同审批问题分析报告.md", type: "document", modified: "2026-10-19", size: "23 KB" },
  { id: "erp-sheet", parent: "erp", name: "接口联调清单.xlsx", type: "document", modified: "2026-10-12", size: "54 KB" },
  { id: "release-md", parent: "releases", name: "Synapse-1.0.77-发布说明.md", type: "document", modified: "2026-10-19", size: "12 KB", shared: true },
  { id: "release-zip", parent: "releases", name: "Synapse-1.0.77.zip", type: "archive", modified: "2026-10-19", size: "48 MB" },
  { id: "old-search", parent: "releases", name: "云盘文件搜索设计-旧版.md", type: "document", modified: "2026-09-18", size: "10 KB" },
  { id: "page", parent: "web", name: "云盘搜索原型.html", type: "document", modified: "2026-10-20", size: "96 KB", shared: true },
  { id: "report", parent: "web", name: "Gitee缺陷分析报告-2026Q2.html", type: "document", modified: "2026-07-01", size: "72 KB" },
  { id: "other", parent: "releases", name: "同步诊断.log", type: "other", modified: "2026-10-18", size: "102 KB" },
  { id: "projects", parent: null, name: "项目资料", type: "folder", modified: "2026-10-20", size: "—" },
  { id: "releases", parent: null, name: "发布归档", type: "folder", modified: "2026-10-19", size: "—" },
  { id: "web", parent: null, name: "临时网页", type: "folder", modified: "2026-10-18", size: "—" },
]

export function modifiedLabel(item: Item) {
  if (item.id === "skill") return "46 分钟前"
  const days = Math.floor((TODAY - Date.parse(`${item.modified}T16:00:00+08:00`)) / 86_400_000)
  return days === 0 ? "今天" : `${days} 天前`
}

export function ancestors(parent: string | null): Item[] {
  if (!parent) return []
  const item = ITEMS.find(candidate => candidate.id === parent)!
  return [...ancestors(item.parent), item]
}
export function itemPath(item: Item) { return ["根目录", ...ancestors(item.parent).map(parent => parent.name)].join(" / ") }
export function normalize(value: string) { return value.normalize("NFKC").toLocaleLowerCase().trim() }
export function termsFor(query: string) { return normalize(query).split(/\s+/u).filter(Boolean) }
export function hasFilters(filters: Filters) { return filters.type !== "all" || filters.days !== "all" || filters.shared !== "all" }
export function matchingItems(query: string, filters: Filters, scope: Scope, folder: string | null, sort: Sort): Item[] {
  const terms = termsFor(query)
  const results = ITEMS.filter(item => {
    const inScope = scope === "all" || ancestors(item.parent).some(parent => parent.id === folder) || folder === null
    const matchesDate = filters.days === "all" || Date.parse(`${item.modified}T00:00:00+08:00`) >= TODAY - Number(filters.days) * 86_400_000
    return inScope && terms.every(term => normalize(item.name).includes(term)) && matchesDate
      && (filters.type === "all" || filters.type === item.type)
      && (filters.shared === "all" || Boolean(item.shared) === (filters.shared === "shared"))
  })
  return results.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "zh-CN") || itemPath(a).localeCompare(itemPath(b), "zh-CN")
    if (sort === "relevance" && terms.length) {
      const score = (item: Item) => normalize(item.name) === normalize(query) ? 2 : normalize(item.name).startsWith(terms[0]) ? 1 : 0
      const difference = score(b) - score(a)
      if (difference) return difference
    }
    return b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id)
  })
}
