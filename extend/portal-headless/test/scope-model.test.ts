import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { validatePortalScope, type PortalScopeModel } from '../src/catalog/scope.js'

type PageCatalogItem = {
  menuPath: string | null
  permission: string
  menuSource: string
  kind: string
}

const scope = JSON.parse(readFileSync(new URL('../generated/portal-scope.json', import.meta.url), 'utf8')) as PortalScopeModel
const pageCatalog = JSON.parse(readFileSync(new URL('../generated/page-catalog.json', import.meta.url), 'utf8')) as {
  items: PageCatalogItem[]
}

const itemByKey = (key: string) => scope.items.find((item) => item.key === key)

describe('Portal 菜单范围模型', () => {
  it('固定七个范围根，且每个根都有归属节点', () => {
    expect(scope.roots.map((root) => root.title)).toEqual([
      '智能助手',
      '个人用量',
      '待办事项',
      '系统设置',
      '人工智能',
      '平台设置',
      '人力',
    ])

    const rootIds = new Set(scope.roots.map((root) => root.rootId))
    expect(scope.items.every((item) => rootIds.has(item.rootId))).toBe(true)
    expect(scope.items.every((item) => item.included)).toBe(true)
  })

  it('注释菜单不进入范围；portal、platform、hr 的范围选择彼此独立', () => {
    expect(itemByKey('/dashboard/course/live-course/list')).toBeUndefined()
    expect(itemByKey('/dashboard/setting/area/list')).toBeUndefined()

    expect(itemByKey('/dashboard/chat')).toMatchObject({ rootId: 'portal/智能助手', sourceSystem: 'portal' })
    expect(itemByKey('/dashboard/model-usage/list')).toMatchObject({ rootId: 'portal/个人用量' })
    expect(itemByKey('/dashboard/backlog/task-examine/list')).toMatchObject({ rootId: 'portal/待办事项' })

    expect(itemByKey('/dashboard/platform/intelligence/knowledge/document/workspace/list')).toMatchObject({
      rootId: 'platform/人工智能',
      sourceSystem: 'platform',
    })
    expect(itemByKey('/dashboard/platform/setting/dict-mall/all/list')).toMatchObject({ rootId: 'platform/平台设置' })
    expect(itemByKey('/dashboard/platform/user/list')).toBeUndefined()

    expect(itemByKey('/dashboard/staff/staff-list/list')).toMatchObject({ rootId: 'hr/人力' })
    expect(itemByKey('/dashboard/setting/system-accounting-parameters/list')).toMatchObject({ rootId: 'portal/系统设置', sourceSystem: 'hr' })
  })

  it('系统设置保留跨文件 setting_menus，而同文件业务 all_menus 不在范围', () => {
    for (const [key, sourceSystem] of [
      ['/dashboard/finance/setting/accounting-period/list', 'finance'],
      ['/dashboard/setting/material/list', 'common'],
      ['/dashboard/material/assets/code-setting/list', 'material'],
      ['/dashboard/product/setting/base-setting/user-dict/list', 'product'],
      ['/dashboard/technology/setting/project-type/list', 'technology'],
      ['/dashboard/sale/setting/price-control/list', 'sale'],
      ['/dashboard/supply/setting/planner/list', 'supply'],
      ['/dashboard/setting/system-accounting-parameters/list', 'hr'],
    ] as const) {
      const item = itemByKey(key)
      expect(item, `${key} should be in 系统设置`).toMatchObject({
        rootId: 'portal/系统设置',
        sourceSystem,
      })
    }

    expect(itemByKey('/dashboard/finance/expenditure/budget-summary-approval/list')).toBeUndefined()
    expect(itemByKey('/dashboard/material/store/material-store/list')).toBeUndefined()
    expect(itemByKey('/dashboard/product/operation/business/user-analysis/list')).toMatchObject({
      rootId: 'portal/系统设置',
      sourceSystem: 'product',
      status: 'included',
      callable: true,
    })
    expect(itemByKey('/dashboard/sale/order/list')).toBeUndefined()
    expect(itemByKey('/dashboard/supply/purchase/list')).toBeUndefined()
  })

  it('hr iframe 以 permission 为 key，并标记为外部不可调用', () => {
    const item = itemByKey('/dashboard/frame/bpm/manager/model')
    expect(item).toMatchObject({
      menuPath: null,
      permission: '/dashboard/frame/bpm/manager/model',
      rootId: 'hr/人力',
      sourceSystem: 'hr',
      status: 'external',
      callable: false,
    })
    expect(item?.parentTitles).toContain('流程管理')
  })

  it('范围项与 page-catalog 的路径/权限逐项一致', () => {
    for (const item of scope.items) {
      const match = pageCatalog.items.find((candidate) => (
        candidate.menuPath === item.menuPath && candidate.permission === item.permission
      ))
      expect(match, `${item.key} 不在 page-catalog 或权限不一致`).toBeDefined()
      expect(match?.menuSource, `${item.key} 来源文件不一致`).toBe(item.menuSource)
      expect(match?.kind === 'iframe 嵌入外部系统', `${item.key} 页面形态不一致`).toBe(item.kind === 'iframe')
    }
  })

  it('模型自检能发现重复、越界和无归属项（反证）', () => {
    expect(validatePortalScope(scope)).toEqual([])

    const duplicate = structuredClone(scope)
    duplicate.items.push(structuredClone(scope.items[0]!))
    expect(validatePortalScope(duplicate)).toEqual(expect.arrayContaining([expect.stringContaining('重复')]))

    const duplicatePermission = structuredClone(scope)
    duplicatePermission.items.push({
      ...scope.items[1]!,
      key: '/dashboard/synthetic/duplicate-permission',
      menuPath: '/dashboard/synthetic/duplicate-permission',
      permission: scope.items[0]!.permission,
    })
    expect(validatePortalScope(duplicatePermission)).toEqual(expect.arrayContaining([expect.stringContaining('重复权限路径')]))

    const outside = structuredClone(scope)
    outside.items.push({ ...scope.items[0]!, key: '/dashboard/platform/user/list', menuPath: '/dashboard/platform/user/list' })
    expect(validatePortalScope(outside)).toEqual(expect.arrayContaining([expect.stringContaining('范围外')]))

    const securityAudit = structuredClone(scope)
    securityAudit.items.push({
      ...scope.items.find((item) => item.rootId === 'platform/平台设置')!,
      key: '/dashboard/platform/setting/log/login/list',
      menuPath: '/dashboard/platform/setting/log/login/list',
      permission: '/dashboard/platform-v2/setting/log/login',
    })
    expect(validatePortalScope(securityAudit)).toEqual(expect.arrayContaining([expect.stringContaining('范围外')]))

    const crossRoot = structuredClone(scope)
    const hrItem = crossRoot.items.find((item) => item.rootId === 'hr/人力')!
    hrItem.rootId = 'portal/系统设置'
    expect(validatePortalScope(crossRoot)).toEqual(expect.arrayContaining([expect.stringContaining('范围外')]))

    const orphan = structuredClone(scope)
    orphan.items[0] = { ...orphan.items[0]!, rootId: 'portal/missing' }
    expect(validatePortalScope(orphan)).toEqual(expect.arrayContaining([expect.stringContaining('无归属')]))
  })
})
