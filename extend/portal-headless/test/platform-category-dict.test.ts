import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import {
  createPlatformCategoryDictCapability,
  platformCategoryDictCapabilities,
  PLATFORM_CATEGORY_DICT_METHODS,
  PLATFORM_CATEGORY_DICT_PAGE_PATH,
} from '../src/capabilities/platform-category-dict.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createPlatformCategoryDictCapability(request), calls }
}

const tree = [{
  id: '100', pid: 0, name: '合同', code: 'contract', tenantId: 0, platform: true, tenantEditable: 1,
  createTime: '2026-09-23 09:00:00', children: [{
    id: '101', pid: '100', name: '采购', code: 'purchase', tenantId: 7, platform: false, tenantEditable: 0,
    createTime: null, children: [],
  }],
}]

describe('Portal 平台设置 → 分类字典页面能力', () => {
  it('锁定页面、权限、platform实例、无module-type和完整动作集合', () => {
    expect(platformCategoryDictCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_CATEGORY_DICT_METHODS))
    expect(platformCategoryDictCapabilities.every(item => item.pagePath === PLATFORM_CATEGORY_DICT_PAGE_PATH)).toBe(true)
    expect(platformCategoryDictCapabilities.every(item => item.permission === '/dashboard/platform-v2/setting/category-dict')).toBe(true)
    expect(platformCategoryDictCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(platformCategoryDictCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(platformCategoryDictCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'platform-category-dict-create', 'platform-category-dict-update', 'platform-category-dict-update-inline',
      'platform-category-dict-set-tenant-editable', 'platform-category-dict-remove',
    ])
    expect(resolveModuleType(PLATFORM_CATEGORY_DICT_PAGE_PATH).moduleType).toBeNull()
  })

  it('源码锚定树查询、平台接口前缀、行内编辑、租户开关和删除权限', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/platform/setting/category-dict/list.vue`, 'utf8')
    const modal = readFileSync(`${portalRoot}/app/portal/views/dashboard/platform/setting/category-dict/components/ModalForm.vue`, 'utf8')
    const controller = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/adminmanage/categorydict/ManageCategoryDictController.java', 'utf8')
    expect(source).toContain("getDataListURL: `${categoryDictApiPrefix}/system/category-dict/tree`")
    expect(source).toContain("deleteURL: `${categoryDictApiPrefix}/system/category-dict/delete`")
    expect(source).toContain("http.post(`${categoryDictApiPrefix}/system/category-dict/create`")
    expect(source).toContain("http.put(`${categoryDictApiPrefix}/system/category-dict/update`")
    expect(source).toContain('rrList.actionDelete(record)')
    expect(source).toContain("tenantEditable: data.tenantEditable === 0 ? 0 : 1")
    expect(modal).toContain("name: [{ required: true, message: '请输入名称' }]")
    expect(controller).toContain('@PostMapping("/create")')
    expect(controller).toContain('@PutMapping("/update")')
    expect(controller).toContain('@DeleteMapping("/delete/{id}")')
    expect(controller).toContain('仅维护 tenant_id = 0 的平台共享分类')
  })

  it('树查询逐字段保留节点、租户来源和子树，空筛选参数与Portal一致', async () => {
    const f = setup([tree, tree])
    await expect(f.api.list()).resolves.toEqual(tree)
    expect(f.calls[0]).toEqual({
      url: '/adminmanage-api/system/category-dict/tree', method: 'get',
      params: { order: '', orderField: '', name: '', code: '' },
    })
    await f.api.list({ name: '合同', code: 'contract' })
    expect(f.calls[1]?.params).toEqual({ order: '', orderField: '', name: '合同', code: 'contract' })
  })

  it('创建和编辑严格复现根/子节点tenantEditable表单规则', async () => {
    const f = setup([123, 123, true, true])
    await expect(f.api.create({ pid: null, name: '根', code: null })).resolves.toBe(123)
    expect(f.calls[0]?.data).toEqual({ pid: 0, name: '根', code: '', tenantEditable: 0 })
    await expect(f.api.create({ pid: 100, name: '子', code: 'child', tenantEditable: 1 })).resolves.toBe(123)
    expect(f.calls[1]?.data).toEqual({ pid: 100, name: '子', code: 'child' })
    await expect(f.api.update({ id: 101, pid: 100, name: '子2', code: '' })).resolves.toBe(true)
    expect(f.calls[2]?.data).toEqual({ id: 101, pid: 100, name: '子2', code: '' })
    await expect(f.api.updateInline({ id: 101, pid: 100, name: '子3', code: 'child', tenantEditable: 0 })).resolves.toBe(true)
    expect(f.calls[3]?.data).toEqual({ id: 101, pid: 100, name: '子3', code: 'child', tenantEditable: 0 })
  })

  it('根开关、删除、坏参数和权限错误保持失败语义', async () => {
    const f = setup([true, true])
    await expect(f.api.setTenantEditable({ id: 100, pid: 0, name: '根', code: 'root', tenantEditable: true })).resolves.toBe(true)
    expect(f.calls[0]?.data).toEqual({ id: 100, pid: 0, name: '根', code: 'root', tenantEditable: 1 })
    await expect(f.api.remove('101')).resolves.toBe(true)
    expect(f.calls[1]).toEqual({ url: '/adminmanage-api/system/category-dict/delete/101', method: 'delete' })
    await expect(f.api.setTenantEditable({ id: 101, pid: 100, name: '子', code: '', tenantEditable: 1 })).rejects.toThrow('根分类')
    await expect(f.api.create({ pid: 0, name: '' })).rejects.toThrow('name')
    const malformed = setup([[{ id: 1, pid: 0, name: '根', children: [{}] }]])
    await expect(malformed.api.list()).rejects.toThrow('children')
    const denied = setup([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
  })
})
