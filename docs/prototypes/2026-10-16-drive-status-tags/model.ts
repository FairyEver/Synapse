export type SyncState = "active" | "paused" | "conflict" | "offline" | "uploading"
export interface Share {
  access: "link_read" | "link_edit" | "specified_users_edit"
  password: boolean
  expires: string | null
  expired?: boolean
  editors?: number
}
export interface Binding {
  id: string
  root: string
  local: string
  state: SyncState
  lastSync: string
}
export interface Item {
  id: string
  parent: string | null
  name: string
  folder?: boolean
  updated: string
  share?: Share
  binding?: string
  inherited?: boolean
  excluded?: string
  contains?: string
}

export function initialBindings(): Binding[] {
  return [
    { id: "project", root: "project", local: "/Users/demo/Documents/项目资料", state: "active", lastSync: "今天 14:32" },
    { id: "codex", root: "codex", local: "/Users/demo/Documents/1 codex的设计.md", state: "active", lastSync: "今天 14:31" },
    { id: "report", root: "report", local: "/Users/demo/Reports/Gitee缺陷分析报告-2026Q3.html", state: "paused", lastSync: "昨天 18:40" },
    { id: "conflict", root: "conflict", local: "/Users/demo/Documents/不同用户不同首页-三端实施阻塞评估-2026-10-13.md", state: "conflict", lastSync: "今天 13:16" },
    { id: "upload", root: "upload", local: "/Users/demo/Documents/云盘同步重设计.html", state: "uploading", lastSync: "今天 14:20" },
    { id: "offline", root: "offline", local: "/Users/demo/Documents/合同审批_App端无法提交_代码分析.md", state: "active", lastSync: "昨天 17:20" },
  ]
}

export function initialItems(): Item[] {
  return [
    { id: "project", parent: null, name: "项目资料", folder: true, updated: "刚刚", share: { access: "specified_users_edit", editors: 3, password: true, expires: "2026-10-23 23:59" }, binding: "project" },
    { id: "ds", parent: null, name: "1 ds的设计.md", updated: "6 小时前", share: { access: "link_read", password: false, expires: null } },
    { id: "codex", parent: null, name: "1 codex的设计.md", updated: "6 小时前", share: { access: "link_edit", password: false, expires: null }, binding: "codex" },
    { id: "report", parent: null, name: "Gitee缺陷分析报告-2026Q3.html", updated: "1 天前", share: { access: "link_read", password: true, expires: "2026-10-23 23:59" }, binding: "report" },
    { id: "conflict", parent: null, name: "不同用户不同首页-三端实施阻塞评估-2026-10-13.md", updated: "3 天前", share: { access: "link_read", password: false, expires: null }, binding: "conflict" },
    { id: "testkit", parent: null, name: "TestKit 产品介绍.html", updated: "6 天前", share: { access: "link_read", password: false, expires: null } },
    { id: "upload", parent: null, name: "云盘同步重设计.html", updated: "16 天前", binding: "upload" },
    { id: "plain", parent: null, name: "gtr-AI使用指南.md", updated: "16 天前" },
    { id: "archive", parent: null, name: "发布归档", folder: true, updated: "16 天前", contains: "offline" },
    { id: "expired", parent: null, name: "2026-09-28-portal-form-footer-unification-execution.md", updated: "18 天前", share: { access: "link_read", password: true, expires: "2026-10-15 23:59", expired: true } },
    { id: "requirements", parent: "project", name: "需求说明.md", updated: "刚刚", binding: "project", inherited: true },
    { id: "design", parent: "project", name: "交互设计.md", updated: "10 分钟前", share: { access: "link_read", password: false, expires: null }, binding: "project", inherited: true },
    { id: "assets", parent: "project", name: "素材", folder: true, updated: "30 分钟前", binding: "project", inherited: true },
    { id: "dist", parent: "project", name: "dist", folder: true, updated: "1 小时前", binding: "project", inherited: true, excluded: "dist/" },
    { id: "image", parent: "assets", name: "界面截图.png", updated: "30 分钟前", binding: "project", inherited: true },
    { id: "dist-file", parent: "dist", name: "index.html", updated: "1 小时前", binding: "project", inherited: true, excluded: "dist/" },
    { id: "offline", parent: "archive", name: "合同审批_App端无法提交_代码分析.md", updated: "16 天前", binding: "offline" },
  ]
}

export function ancestors(item: Item, items: Item[]): Item[] {
  const result: Item[] = []
  let parent = items.find(candidate => candidate.id === item.parent)
  while (parent) { result.unshift(parent); parent = items.find(candidate => candidate.id === parent?.parent) }
  return result
}
export function cloudPath(item: Item, items: Item[]): string {
  return "/" + [...ancestors(item, items).map(parent => parent.name), item.name].join("/")
}
export function localPath(item: Item, binding: Binding, items: Item[]): string {
  const root = items.find(candidate => candidate.id === binding.root)!
  return binding.local + cloudPath(item, items).slice(cloudPath(root, items).length)
}
export function shareAccess(share: Share): string {
  if (share.access === "specified_users_edit") return `指定 ${share.editors ?? 0} 人可编辑`
  return share.access === "link_edit" ? "持链接可阅读，登录后可编辑" : "持链接可阅读"
}
export function syncLabel(item: Item, binding: Binding): string {
  if (item.contains) return "含同步项"
  if (item.excluded) return "已排除同步"
  return { active: "同步", paused: "同步已暂停", conflict: "同步有冲突", offline: "同步离线", uploading: "同步上传中" }[binding.state]
}
export function syncStatus(binding: Binding): string {
  return { active: "已同步", paused: "已暂停", conflict: "两端都有修改", offline: "离线，等待连接", uploading: "正在上传 · 64%" }[binding.state]
}
