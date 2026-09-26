import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingSupplierCapability,
  SETTING_SUPPLIER_METHODS,
  SETTING_SUPPLIER_MODULE_TYPE,
  SETTING_SUPPLIER_PAGE_PATH,
  SETTING_SUPPLIER_PERMISSION,
  settingSupplierCapabilities,
} from '../src/capabilities/setting-supplier.js'
import { SETTING_SUPPLIER_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-supplier.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingSupplierCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const supplier = {
  id: '9007199254740993', supplierCode: '10001', supplierName: '甲公司', supplierAbbreviation: '甲', type: 1, category: null,
  address: '杭州', qualificationCode: 'Q-001', createTime: '2026-09-23 10:00:00', updateTime: '2026-09-23 10:00:00', updaterName: '管理员',
  addedByTenant: true, selectable: true, sysBrandIds: '', sysBrandNames: null,
}

describe('Portal 系统设置 → 供应商管理页面能力', () => {
  it('逐页锁定菜单、列表、新建表单、平台选择、platform实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/setting/supplier/list.vue')
    const create = read(portalRoot, 'app/portal/views/dashboard/hr/setting/supplier/[mode]/[id].vue')
    const platform = read(portalRoot, 'app/portal/components/portal/supply/platform-table-select/supplier.vue')
    for (const fragment of [`path: '${SETTING_SUPPLIER_PAGE_PATH}'`, `permission: '${SETTING_SUPPLIER_PERMISSION}'`]) expect(menu).toContain(fragment)
    for (const fragment of [
      "getDataListURL: '/admin-api/system/sys-supplier/page'", "supplierName: ''", "supplierCode: ''", "type: undefined",
      "url: '/admin-api/system/sys-supplier/delete'", "newPageWithPlatformAuth('/admin-api/system/sys-supplier/export'", "update-use-tenant",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "http.post('/admin-api/system/sys-supplier/batch-create'", "sysBrandIds: item.sysBrandIds.join(',')", "isSysCreate: true",
      'postalCodeRules', '/^\\d{6}$/', 'normalizePostalCode', 'getBrandList()',
    ]) expect(create).toContain(fragment)
    for (const fragment of [
      "getDataListURL: '/admin-api/system/sys-supplier/select-platform-page'", 'selectCrossPage: true', 'disabled: !record.selectable',
    ]) expect(platform).toContain(fragment)
    expect(settingSupplierCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_SUPPLIER_METHODS))
    expect(settingSupplierCapabilities.every(item => item.pagePath === SETTING_SUPPLIER_PAGE_PATH && item.permission === SETTING_SUPPLIER_PERMISSION && item.moduleType === SETTING_SUPPLIER_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_SUPPLIER_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java 端点、字段校验、采购属性删除限制和当前租户平台关联', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system')
    const controller = read(root, 'controller/admin/supplier/SysSupplierController.java')
    const base = read(root, 'controller/admin/supplier/vo/SysSupplierBaseVO.java')
    const save = read(root, 'controller/admin/supplier/vo/SysSupplierSaveReqVO.java')
    const service = read(root, 'service/supplier/SysSupplierServiceImpl.java')
    const platformService = read(root, 'service/supplier/PlatformSupplierServiceImpl.java')
    for (const fragment of [
      '@RequestMapping("/system/sys-supplier")', '@GetMapping("/page")', '@GetMapping("/export")', '@PostMapping("/batch-create")',
      '@DeleteMapping("/delete")', '@GetMapping("/select-platform-page")', '@PostMapping("/update-use-tenant")', '@DataPermission',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['@NotBlank(message = "供应商名称不能为空")', 'private String supplierName', 'private String supplierAbbreviation', 'private Integer type']) expect(base).toContain(fragment)
    expect(save).toContain('private Boolean isSysCreate')
    for (const fragment of ['采购属性', 'supplierApi.getSupplierBaseAttributeCountBySupplierId', 'TenantContextHolder.getTenantId()', 'sysSupplierMapper.deleteById(id)']) expect(service).toContain(fragment)
    for (const fragment of ['updateSupplierUseTenant(List<Long> supplierIds, Long tenantId)', 'TenantIgnore', 'addTenantIdToUseTenant']) expect(platformService).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖列表、导出、新建、删除、平台选择和添加', async () => {
    const exportResponse = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': "attachment; filename*=UTF-8''系统供应商.xls" } }
    const f = fixture([
      { list: [supplier], total: 1 }, exportResponse, ['101', '102'], true,
      { list: [supplier], total: 1 }, true,
    ])
    await expect(f.api.list()).resolves.toEqual({ list: [supplier], total: 1 })
    await expect(f.api.export()).resolves.toMatchObject({ fileName: '系统供应商.xls', base64: 'AQID', byteLength: 3 })
    await expect(f.api.create({ suppliers: [{ supplierName: '供应商', supplierAbbreviation: '供', supplierCode: '', type: '1', address: '', postalCode: '123456', qualificationCode: 'Q', sysBrandIds: [7, '8'], isSysCreate: true }] })).resolves.toEqual(['101', '102'])
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.platformList()).resolves.toEqual({ list: [supplier], total: 1 })
    await expect(f.api.addPlatform({ supplierIds: [101], tenantId: 8 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/system/sys-supplier/page', method: 'get', params: { order: '', orderField: '', supplierName: '', supplierCode: '', type: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/system/sys-supplier/export', method: 'get', params: { supplierName: '', supplierCode: '', type: undefined }, responseType: 'arraybuffer' },
      { url: '/admin-api/system/sys-supplier/batch-create', method: 'post', data: [{ supplierName: '供应商', supplierAbbreviation: '供', supplierCode: '', type: '1', address: '', postalCode: '123456', qualificationCode: 'Q', sysBrandIds: '7,8', isSysCreate: true }] },
      { url: '/admin-api/system/sys-supplier/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/sys-supplier/select-platform-page', method: 'get', params: { order: '', orderField: '', supplierName: '', supplierCode: '', type: null, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/system/sys-supplier/update-use-tenant', method: 'post', data: { supplierIds: [101], tenantId: 8 } },
    ])
  })

  it('表单、筛选、平台选择、分页和坏响应在请求前或边界处失败', async () => {
    const f = fixture([])
    await expect(f.api.create({ suppliers: [{ supplierName: '供应商', supplierAbbreviation: ' ', type: 1 }] })).rejects.toThrow('supplierAbbreviation')
    await expect(f.api.create({ suppliers: [{ supplierName: '供应商', supplierAbbreviation: '供', type: 1, postalCode: '123' }] })).rejects.toThrow('postalCode')
    await expect(f.api.create({ suppliers: [{ supplierName: '供应商', supplierAbbreviation: '供', type: null as never }] })).rejects.toThrow('type')
    await expect(f.api.create({ suppliers: [] })).rejects.toThrow('suppliers')
    await expect(f.api.addPlatform({ supplierIds: [], tenantId: 8 })).rejects.toThrow('supplierIds')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.platformList({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('供应商ID')
    expect(f.calls).toEqual([])

    const malformed = fixture([{ list: [], total: -1 }])
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    const emptyFile = fixture([{ data: new ArrayBuffer(0), headers: {} }])
    await expect(emptyFile.api.export()).rejects.toThrow('为空文件')
    const denied = fixture([new Error('无权限')])
    await expect(denied.api.list()).rejects.toThrow('无权限')
  })

  it('AI说明覆盖表单提交、删除语义、平台租户权限和导出上限，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_SUPPLIER_METHODS).sort())
    expect(contracts['setting-supplier-create']?.inputs.suppliers?.constraints?.join(' ')).toContain('postalCode')
    expect(contracts['setting-supplier-create']?.boundaries.join(' ')).toContain('sysBrandIds')
    expect(contracts['setting-supplier-add-platform']?.boundaries.join(' ')).toContain('TenantContextHolder')
    expect(contracts['setting-supplier-remove']?.boundaries.join(' ')).toContain('采购属性')
    expect(contracts['setting-supplier-export']?.output.fields.find(item => item.path === 'base64')?.meaning).toContain('base64')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
