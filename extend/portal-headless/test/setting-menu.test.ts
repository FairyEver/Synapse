import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingMenuCapability,
  SETTING_MENU_METHODS,
  SETTING_MENU_MODULE_TYPE,
  SETTING_MENU_PAGE_PATH,
  SETTING_MENU_PERMISSION,
  settingMenuCapabilities,
} from '../src/capabilities/setting-menu.js'
import { SETTING_MENU_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-menu.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingMenuCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const child = { id: '2', pid: '1', name: '子菜单', url: null, menuType: 0, project: 2, icon: null, permissions: '/child', sort: 2, createDate: null, parentName: '根菜单', useSystem: 1, children: [] }
const tree = [{ id: '1', pid: '0', name: '根菜单', url: '/dashboard/root', menuType: 0, project: 2, icon: 'menu', permissions: '/root', sort: 1, createDate: '2026-09-23 10:00:00', parentName: null, useSystem: 1, children: [child] }]

describe('Portal 系统设置 → 菜单管理页面能力', () => {
  it('逐页锁定菜单、dev写按钮、隐藏路由、platform实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/setting/menu/list.vue')
    const form = read(portalRoot, 'app/portal/views/dashboard/hr/setting/menu/[mode]/[id].vue')
    const remove = read(portalRoot, 'app/portal/views/dashboard/hr/setting/menu/composables/useTreeDelete.js')
    const importTree = read(portalRoot, 'app/portal/views/dashboard/hr/setting/menu/composables/useJsonMenuImport.js')
    const bulk = read(portalRoot, 'app/portal/views/dashboard/hr/setting/menu/components/edit-multiple-value.vue')
    expect(menu).toContain(`path: '${SETTING_MENU_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_MENU_PERMISSION}'`)
    for (const fragment of [
      "const isDev = import.meta.env.VITE_API_ENV_NAME === 'dev'",
      "getDataListURL: '/admin-api/sys/menu/menuListNotBySystem'",
      "deleteURL: '/admin-api/sys/menu'",
      "http.post('/admin-api/sys/menu'",
      'actionBatchAddChildren',
      'actionQuickMove',
      'exportAsJson',
      'exportAsText',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "http.get(`/admin-api/sys/menu/${id}`)",
      "http.put('/admin-api/sys/menu', form)",
      "id: ''",
      "pid: '0'",
      "useSystem: SYSTEM_HR_VALUE",
      "name: [{ required: true, message: '必填' }]",
    ]) expect(form).toContain(fragment)
    for (const fragment of ['先删所有后代', "http.delete(`${deleteURL}/${id}`)"]) expect(remove).toContain(fragment)
    for (const fragment of ["http.post('/admin-api/sys/menu'", 'node.children', 'completedCount.value++']) expect(importTree).toContain(fragment)
    expect(bulk).toContain("http.put('/admin-api/sys/menu'")
    expect(settingMenuCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_MENU_METHODS))
    expect(settingMenuCapabilities.every(item => item.pagePath === SETTING_MENU_PAGE_PATH && item.permission === SETTING_MENU_PERMISSION && item.moduleType === SETTING_MENU_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_MENU_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java Controller、DTO、Service、Mapper 的校验和删除权限边界', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main')
    const controller = read(root, 'java/com/wdbc/erp/module/system/controller/admin/menu/HrSysMenuController.java')
    const service = read(root, 'java/com/wdbc/erp/module/system/service/menu/HrSysMenuServiceImpl.java')
    const dto = read(root, 'java/com/wdbc/erp/module/system/controller/admin/menu/dto/SysMenuDTO.java')
    const mapper = read(root, 'resources/mapper/menu/SysMenuDao.xml')
    for (const fragment of ['@RequestMapping("sys/menu")', '@GetMapping("menuListNotBySystem")', '@PostMapping', '@PutMapping', '@DeleteMapping("{id}")', 'ValidatorUtils.validateEntity(dto, DefaultGroup.class)']) expect(controller).toContain(fragment)
    for (const fragment of ['public List<SysMenuDTO> listNotBySystem()', 'getMenuListNotBySystem()', 'TreeUtils.build(dtoList', 'public List<SysMenuDTO> getListPid(Long pid)']) expect(service).toContain(fragment)
    for (const fragment of ['extends TreeNode<SysMenuDTO>', '@NotNull(message="{sysmenu.pid.require}"', '@NotBlank(message="{sysmenu.name.require}"', '@Range(min=0, max=1', 'private Integer useSystem']) expect(dto).toContain(fragment)
    for (const fragment of ['<select id="getMenuListNotBySystem"', 'from hr_sys_menu t1', 'order by t1.sort asc']) expect(mapper).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖列表、详情、单条/批量/树写入和后序删除', async () => {
    const f = fixture([tree, child, '3', '4', '5', '6', '7', true, true, true, true])
    await expect(f.api.list()).resolves.toEqual(tree)
    await expect(f.api.get({ id: '2' })).resolves.toEqual(child)
    await expect(f.api.create({ name: '新菜单', pid: '1', permissions: '/new', useSystem: 1, project: 2 })).resolves.toBe('3')
    await expect(f.api.createMany({ items: [{ name: '批量一', pid: '1', useSystem: 1, project: 2 }, { name: '批量二', pid: '1', permissions: '', useSystem: 1, project: 2 }] })).resolves.toEqual(['4', '5'])
    await expect(f.api.importTree({ nodes: [{ title: '导入根', permission: '/import', children: [{ title: '导入子', permission: '/import/child' }] }], pid: '1', useSystem: 1, project: 2 })).resolves.toEqual({ created: [{ path: '导入根', id: '6' }, { path: '导入根 > 导入子', id: '7' }], failed: [] })
    await expect(f.api.update({ id: '2', name: '子菜单改', pid: '1', permissions: '/child2', useSystem: 1, project: 2 })).resolves.toBe(true)
    await expect(f.api.updateMany({ items: [{ id: '2', name: '子菜单再改', pid: '1', permissions: '/child3', useSystem: 1, project: 2 }] })).resolves.toEqual(['2'])
    await expect(f.api.remove({ id: '1', children: [{ id: '2', children: [] }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/sys/menu/menuListNotBySystem', method: 'get', params: { order: '', orderField: '' } },
      { url: '/admin-api/sys/menu/2', method: 'get' },
      { url: '/admin-api/sys/menu', method: 'post', data: { name: '新菜单', pid: '1', permissions: '/new', useSystem: 1, project: 2, id: '' } },
      { url: '/admin-api/sys/menu', method: 'post', data: { name: '批量一', pid: '1', useSystem: 1, project: 2, id: '', permissions: '' } },
      { url: '/admin-api/sys/menu', method: 'post', data: { name: '批量二', pid: '1', permissions: '', useSystem: 1, project: 2, id: '' } },
      { url: '/admin-api/sys/menu', method: 'post', data: { name: '导入根', pid: '1', permissions: '/import', useSystem: 1, project: 2, id: '' } },
      { url: '/admin-api/sys/menu', method: 'post', data: { name: '导入子', pid: '6', permissions: '/import/child', useSystem: 1, project: 2, id: '' } },
      { url: '/admin-api/sys/menu', method: 'put', data: { id: '2', name: '子菜单改', pid: '1', permissions: '/child2', useSystem: 1, project: 2 } },
      { url: '/admin-api/sys/menu', method: 'put', data: { id: '2', name: '子菜单再改', pid: '1', permissions: '/child3', useSystem: 1, project: 2 } },
      { url: '/admin-api/sys/menu/2', method: 'delete' },
      { url: '/admin-api/sys/menu/1', method: 'delete' },
    ])
  })

  it('输入边界、树导入部分失败、坏树响应和后端错误显式失败', async () => {
    const f = fixture([])
    await expect(f.api.create({ name: ' ', pid: 0 })).rejects.toThrow('name')
    await expect(f.api.create({ name: '一级', pid: -1 })).rejects.toThrow('pid')
    await expect(f.api.createMany({ items: [] })).rejects.toThrow('items')
    await expect(f.api.importTree({ nodes: [], pid: 0, useSystem: 1 })).rejects.toThrow('nodes')
    await expect(f.api.update({ id: 0, name: '菜单', pid: 0 })).rejects.toThrow('id')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('id')
    expect(f.calls).toHaveLength(0)
    const malformed = fixture([[{ id: 1, pid: 0, children: 'bad' }]])
    await expect(malformed.api.list()).rejects.toThrow('children')
    const denied = fixture([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
  })

  it('AI说明覆盖dev可见性、表单规则、批量顺序、权限和树删除，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_MENU_METHODS).sort())
    expect(contracts['setting-menu-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['[].id', '[].children', '[].children[].id']))
    expect(contracts['setting-menu-remove']?.boundaries.join(' ')).toContain('后序遍历')
    expect(contracts['setting-menu-import-tree']?.inputs.nodes?.type).toBe('object[]')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
