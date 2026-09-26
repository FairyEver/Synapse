import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PORTAL_SCOPE_SCHEMA = 'portal-menu-scope/v1'

export type PortalScopeRoot = {
  rootId: string
  title: string
  sourceSystem: string
  menuSource: string
  selector: string
  included: boolean
  evidence: string[]
}

export type PortalScopeItem = {
  /** Stable identity: menuPath for pages, permission for pathless iframe entries. */
  key: string
  title: string
  menuPath: string | null
  permission: string
  parentTitles: string[]
  menuSource: string
  sourceSystem: string
  rootId: string
  included: boolean
  status: 'included' | 'external'
  callable: boolean
  reason: string
  evidence: string[]
  kind: 'page' | 'iframe'
}

export type PortalScopeModel = {
  schema: string
  sourceRevision: string
  sourceContentHash: string
  source: {
    repo: string
    branch: string
    files: string[]
  }
  roots: PortalScopeRoot[]
  items: PortalScopeItem[]
  summary: {
    itemCount: number
    callableCount: number
    externalCount: number
    byRoot: Record<string, number>
  }
  validation: {
    ok: boolean
    errors: string[]
  }
}

const FIXED_ROOTS = [
  ['portal/智能助手', '智能助手'],
  ['portal/个人用量', '个人用量'],
  ['portal/待办事项', '待办事项'],
  ['portal/系统设置', '系统设置'],
  ['platform/人工智能', '人工智能'],
  ['platform/平台设置', '平台设置'],
  ['hr/人力', '人力'],
] as const

const ROOT_TITLES: ReadonlyMap<string, string> = new Map(FIXED_ROOTS)

function isPortalSettingPath (item: PortalScopeItem): boolean {
  if (item.sourceSystem === 'common') {
    return item.menuSource === 'app/portal/menus/common.js' && item.menuPath?.startsWith('/dashboard/setting/') === true
  }
  if (item.sourceSystem === 'hr') {
    return item.menuSource === 'app/portal/menus/hr.js' && item.menuPath === '/dashboard/setting/system-accounting-parameters/list'
  }
  if (item.sourceSystem === 'finance') return item.menuPath?.startsWith('/dashboard/finance/setting/') === true
  if (item.sourceSystem === 'material') return item.menuPath?.startsWith('/dashboard/material/') === true
  if (item.sourceSystem === 'product') {
    return item.menuPath?.startsWith('/dashboard/product/setting/') === true ||
      item.menuPath === '/dashboard/product/prevention/plan/program-library/list' ||
      item.menuPath === '/dashboard/product/operation/notice-config/list' ||
      item.menuPath === '/dashboard/product/operation/business/user-analysis/list' ||
      item.menuPath === '/dashboard/product/operation/veterinarians/usage-analysis/list' ||
      item.menuPath === '/dashboard/product/operation/business/usage-chicken/list' ||
      item.menuPath === '/dashboard/product/operation/business/usage-layer/list'
  }
  if (item.sourceSystem === 'sale') return item.menuPath?.startsWith('/dashboard/sale/setting/') === true || item.menuPath?.startsWith('/dashboard/sale/sys/') === true || item.menuPath?.startsWith('/dashboard/sale/job/') === true || item.menuPath?.startsWith('/dashboard/sale/visit/') === true || item.menuPath?.startsWith('/dashboard/sale/order/') === true || item.menuPath?.startsWith('/dashboard/sale/custom/') === true || item.menuPath?.startsWith('/dashboard/sale/customer/') === true
  if (item.sourceSystem === 'supply') return item.menuPath?.startsWith('/dashboard/supply/setting/') === true
  if (item.sourceSystem === 'technology') return item.menuPath?.startsWith('/dashboard/technology/setting/') === true
  return false
}

function isAllowedForRoot (item: PortalScopeItem): boolean {
  if (item.rootId === 'portal/智能助手') return item.key === '/dashboard/chat'
  if (item.rootId === 'portal/个人用量') return item.key === '/dashboard/model-usage/list'
  if (item.rootId === 'portal/待办事项') return item.key === '/dashboard/backlog/task-examine/list'
  if (item.rootId === 'portal/系统设置') return isPortalSettingPath(item)
  if (item.rootId === 'platform/人工智能') {
    return item.menuSource === 'app/portal/menus/mall.v2.js' &&
      item.menuPath?.startsWith('/dashboard/platform/intelligence/') === true &&
      (item.permission.startsWith('/dashboard/platform-v2/intelligence/') || item.permission.startsWith('/dashboard/platform/intelligence/'))
  }
  if (item.rootId === 'platform/平台设置') {
    return item.menuSource === 'app/portal/menus/mall.v2.js' && (
      item.menuPath?.startsWith('/dashboard/platform/setting/dict-mall/') === true ||
      item.menuPath?.startsWith('/dashboard/platform/system/regular/') === true ||
      item.menuPath?.startsWith('/dashboard/platform/system/queue/') === true ||
      item.menuPath === '/dashboard/platform/setting/open-interface/list' ||
      item.menuPath === '/dashboard/platform/setting/category-dict/list' ||
      item.menuPath === '/dashboard/platform/system/express/list' ||
      item.menuPath === '/dashboard/platform/system/custom/list' ||
      item.menuPath === '/dashboard/platform/system/email/list' ||
      item.menuPath === '/dashboard/platform/system/security-config/list'
    )
  }
  if (item.rootId === 'hr/人力') return item.menuSource === 'app/portal/menus/hr.js'
  return false
}

/**
 * Validate the generated scope without re-reading Portal source.
 * The fixed roots and root-specific predicates deliberately make a widened or
 * re-parented generated file fail closed in tests and CI.
 */
export function validatePortalScope (model: PortalScopeModel): string[] {
  const errors: string[] = []
  const roots = new Set<string>()
  const keys = new Set<string>()
  const menuPaths = new Set<string>()
  const permissions = new Set<string>()

  if (model.schema !== PORTAL_SCOPE_SCHEMA) errors.push(`schema 不匹配：${model.schema}`)

  for (const root of model.roots) {
    if (roots.has(root.rootId)) errors.push(`根重复：${root.rootId}`)
    roots.add(root.rootId)
    if (ROOT_TITLES.get(root.rootId) !== root.title) errors.push(`根漂移：${root.rootId} -> ${root.title}`)
  }
  for (const [rootId, title] of FIXED_ROOTS) {
    if (!roots.has(rootId)) errors.push(`根缺失：${rootId}（${title}）`)
  }

  for (const item of model.items) {
    const expectedKey = item.menuPath ?? item.permission
    if (!expectedKey || item.key !== expectedKey) errors.push(`主键不是菜单/权限路径：${item.key}`)
    if (keys.has(item.key)) errors.push(`重复菜单/权限路径：${item.key}`)
    keys.add(item.key)
    if (item.menuPath !== null) {
      if (menuPaths.has(item.menuPath)) errors.push(`重复菜单路径：${item.menuPath}`)
      menuPaths.add(item.menuPath)
    }
    if (item.permission) {
      if (permissions.has(item.permission)) errors.push(`重复权限路径：${item.permission}`)
      permissions.add(item.permission)
    }
    if (!roots.has(item.rootId)) errors.push(`无归属项：${item.key} -> ${item.rootId}`)
    if (!isAllowedForRoot(item)) errors.push(`范围外项：${item.key} -> ${item.rootId}`)
    if (item.menuPath === null && item.permission.length === 0) errors.push(`无路径 iframe 缺少 permission：${item.title}`)
    if (item.kind === 'iframe' && item.callable) errors.push(`iframe 不可调用约束失败：${item.key}`)
    if (item.kind === 'iframe' && item.status !== 'external') errors.push(`iframe 状态不是 external：${item.key}`)
  }

  const actualRoots = new Set(model.items.map((item) => item.rootId))
  for (const rootId of roots) {
    if (!actualRoots.has(rootId)) errors.push(`根无菜单项：${rootId}`)
  }

  return [...new Set(errors)]
}

let cached: PortalScopeModel | null = null

const EMPTY: PortalScopeModel = {
  schema: PORTAL_SCOPE_SCHEMA,
  sourceRevision: '',
  sourceContentHash: '',
  source: { repo: '', branch: '', files: [] },
  roots: [],
  items: [],
  summary: { itemCount: 0, callableCount: 0, externalCount: 0, byRoot: {} },
  validation: { ok: false, errors: ['未找到 generated/portal-scope.json'] },
}

export function loadPortalScope (): PortalScopeModel {
  if (cached) return cached

  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '../../generated/portal-scope.json'),
    join(here, '../../../generated/portal-scope.json'),
  ]
  for (const file of candidates) {
    try {
      cached = JSON.parse(readFileSync(file, 'utf8')) as PortalScopeModel
      return cached
    } catch {
      continue
    }
  }
  cached = EMPTY
  return cached
}

/** Test seam matching the page-catalog loader. */
export function __setPortalScopeForTest (model: PortalScopeModel | null): void {
  cached = model
}
