import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingFrontendLogCapability,
  SETTING_FRONTEND_LOG_METHODS,
  SETTING_FRONTEND_LOG_MODULE_TYPE,
  SETTING_FRONTEND_LOG_PAGE_PATH,
  SETTING_FRONTEND_LOG_PERMISSION,
  settingFrontendLogCapabilities,
} from '../src/capabilities/setting-frontend-log.js'
import { SETTING_FRONTEND_LOG_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-frontend-log.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingFrontendLogCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const tree = [{ id: '9007199254740993', pid: '0', name: '系统设置', url: '/dashboard/setting', menuType: 0, project: 1, icon: 'setting', permissions: '/dashboard/setting', sort: 1, createDate: '2026-09-23 10:00:00', parentName: null, useSystem: 7, children: [{ id: 22, pid: '9007199254740993', name: '前端日志', url: '/dashboard/setting/log/list', menuType: 0, project: 1, icon: null, permissions: '/dashboard/setting/log', sort: 2, createDate: null, parentName: '系统设置', useSystem: 7, children: [] }] }]

describe('Portal 系统设置 → 前端日志页面能力', () => {
  it('逐页锁定菜单条件、请求、筛选字段、platform实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const page = read(portalRoot, 'app/portal/views/dashboard/hr/setting/log/list.vue')
    expect(menu).toContain("...isProd ? [] : [")
    expect(menu).toContain(`path: '${SETTING_FRONTEND_LOG_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_FRONTEND_LOG_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "getDataListURL: '/admin-api/sys/menu/menuListNotBySystem'",
      'http,',
      "finger: ''",
      "text: ''",
      "dataIndex: 'project'",
      "dataIndex: 'finger'",
      "dataIndex: 'tenantId'",
      'rrList.logicFetch()',
    ]) expect(page).toContain(fragment)
    expect(settingFrontendLogCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_FRONTEND_LOG_METHODS))
    expect(settingFrontendLogCapabilities.every(item => item.pagePath === SETTING_FRONTEND_LOG_PAGE_PATH && item.permission === SETTING_FRONTEND_LOG_PERMISSION && item.moduleType === SETTING_FRONTEND_LOG_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_FRONTEND_LOG_PAGE_PATH).moduleType).toBe(SETTING_FRONTEND_LOG_MODULE_TYPE)
  })

  it('逐页锁定 Java 菜单树 Controller、Service、SQL 和节点字段', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main')
    const controller = read(root, 'java/com/wdbc/erp/module/system/controller/admin/menu/HrSysMenuController.java')
    const service = read(root, 'java/com/wdbc/erp/module/system/service/menu/HrSysMenuServiceImpl.java')
    const mapper = read(root, 'resources/mapper/menu/SysMenuDao.xml')
    const dto = read(root, 'java/com/wdbc/erp/module/system/controller/admin/menu/dto/SysMenuDTO.java')
    for (const fragment of ['@RequestMapping("sys/menu")', '@GetMapping("menuListNotBySystem")', 'hrSysMenuService.listNotBySystem()']) expect(controller).toContain(fragment)
    for (const fragment of ['public List<SysMenuDTO> listNotBySystem()', 'baseDao.getMenuListNotBySystem()', 'TreeUtils.build(dtoList']) expect(service).toContain(fragment)
    for (const fragment of ['<select id="getMenuListNotBySystem"', 'from hr_sys_menu t1', 'order by t1.sort asc']) expect(mapper).toContain(fragment)
    for (const fragment of ['extends TreeNode<SysMenuDTO>', 'private Long id', 'private Long pid', 'private String name', 'private String url', 'private Integer menuType', 'private String permissions', 'private Integer useSystem']) expect(dto).toContain(fragment)
  })

  it('按 Portal 实际请求形状读取非分页菜单树，并保留递归节点字段', async () => {
    const f = fixture([tree, tree])
    await expect(f.api.list()).resolves.toEqual(tree)
    await f.api.list({ text: '日志', finger: 'abc' })
    expect(f.calls).toEqual([
      { url: '/admin-api/sys/menu/menuListNotBySystem', method: 'get', params: { order: '', orderField: '', finger: '', text: '' } },
      { url: '/admin-api/sys/menu/menuListNotBySystem', method: 'get', params: { order: '', orderField: '', finger: 'abc', text: '日志' } },
    ])
  })

  it('坏参数、坏树响应和后端权限/网络错误在请求边界显式失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ text: 1 as unknown as string })).rejects.toThrow('text')
    expect(f.calls).toHaveLength(0)
    const malformed = fixture([[{ id: 1, pid: 0, children: {} }]])
    await expect(malformed.api.list()).rejects.toThrow('children')
    const denied = fixture([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
  })

  it('AI说明覆盖菜单边界、实际返回字段和后端忽略筛选的语义，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_FRONTEND_LOG_METHODS).sort())
    expect(contracts['setting-frontend-log-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['[].id', '[].children', '[].children[].id']))
    expect(contracts['setting-frontend-log-list']?.boundaries.join(' ')).toContain('非生产')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
