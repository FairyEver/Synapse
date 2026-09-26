import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCatalog } from '../src/catalog/index.js'
import { resolveModuleType } from '../src/context/module-type.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'
import {
  SALE_SYS_OFFICE_EDIT_PERMISSION,
  SALE_SYS_OFFICE_METHODS,
  SALE_SYS_OFFICE_MODULE_TYPE,
  SALE_SYS_OFFICE_PAGE_PATH,
  SALE_SYS_OFFICE_PERMISSION,
  SALE_SYS_OFFICE_STOP_BATCH_PERMISSION,
  SALE_SYS_OFFICE_STOP_PERMISSION,
  createSaleSysOfficeCapability,
  saleSysOfficeCapabilities,
} from '../src/capabilities/sale-sys-office.js'
import { SALE_SYS_OFFICE_AI_CONTRACTS as contracts } from '../src/catalog/contracts-sale-sys-office.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSaleSysOfficeCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const row = {
  id: 10,
  pid: null,
  parentId: null,
  orgPath: '总部',
  salesOrgPath: '总部',
  name: '总部',
  code: 'HR-001',
  salesCode: 'SALES-001',
  salesType: 1,
  salesGrade: 2,
  salesMaster: 88,
  salesStatus: 1,
  groupSalesAreaCodes: null,
  salesBusiness: null,
  salesId: 'S-10',
  salesParentId: '0',
  defaultSalesParentId: '0',
  salesParentIds: '0',
  updateTime: '2026-09-24 10:00:00',
}

describe('Portal 系统设置 → 销售设置 → 机构扩展页面能力', () => {
  it('逐页锁定菜单、页面请求、弹窗提交规则和按钮权限', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/sys/office/list.vue')
    const form = read(portalRoot, 'app/portal/views/dashboard/sale/sys/office/ModalFormContent.vue')
    for (const fragment of [`path: '${SALE_SYS_OFFICE_PAGE_PATH}'`, `permission: '${SALE_SYS_OFFICE_PERMISSION}'`]) expect(menu).toContain(fragment)
    for (const fragment of [
      "customLoad (form)", "'/admin-api/sales/organization/page'", "parentId: ''", "salesStatus: 1", 'getDataListIsPage: true', 'selectable: true',
      "'/admin-api/sales/organization/tree'", "dictType: 'sales_organization_status'", "dictType: 'sys_office_grade'", "dictType: 'sys_office_type'",
      "`/admin-api/sales/organization/detail/${record.id}`", "'/admin-api/sales/organization/update'", "'/admin-api/sales/organization/batch-disable'", 'newPageWithPlatformAuth',
      "permissionCheck('sys:office:edit')", "permissionCheck('sys:office:stop')", "permissionCheck('sys:office:stopBatch')",
    ]) expect(list).toContain(fragment)
    expect(list).not.toContain('actionCreate')
    for (const fragment of [
      "'/admin-api/sales/organization/tree'", "'/admin-api/sales/item/getShopCategoryItemTree'", "'/vue/sys/office/checkOfficeCode'",
      "required: true", "value == props.raw.salesId", "form.value.salesType == 3", "groupSalesAreaCodes.join(',')", "form.value.groupSalesBusinessCodes.join(',')",
      "pick(formData, ['id', 'salesId', 'salesCode', 'salesType', 'salesParentId', 'salesParentIds', 'salesGrade', 'salesMaster', 'salesStatus', 'groupSalesAreaCodes', 'salesBusiness'])",
    ]) expect(form).toContain(fragment)
    expect(saleSysOfficeCapabilities.map(item => item.id)).toEqual(Object.keys(SALE_SYS_OFFICE_METHODS))
    expect(saleSysOfficeCapabilities.every(item => item.pagePath === SALE_SYS_OFFICE_PAGE_PATH && item.permission === SALE_SYS_OFFICE_PERMISSION && item.moduleType === SALE_SYS_OFFICE_MODULE_TYPE)).toBe(true)
    expect(saleSysOfficeCapabilities.find(item => item.id === 'sale-sys-office-check-code')?.httpInstance).toBe('crm')
    expect(saleSysOfficeCapabilities.filter(item => item.id !== 'sale-sys-office-check-code').every(item => item.httpInstance === 'platform')).toBe(true)
    expect(SALE_SYS_OFFICE_EDIT_PERMISSION).toBe('sys:office:edit')
    expect(SALE_SYS_OFFICE_STOP_PERMISSION).toBe('sys:office:stop')
    expect(SALE_SYS_OFFICE_STOP_BATCH_PERMISSION).toBe('sys:office:stopBatch')
    expect(resolveModuleType(SALE_SYS_OFFICE_PAGE_PATH).moduleType).toBe(SALE_SYS_OFFICE_MODULE_TYPE)
  })

  it('逐页锁定固定Java路由、DTO字段和后端批量停用返回值', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/organization/SalesOrganizationController.java')
    const pageReq = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/organization/vo/SalesOrganizationPageReqVO.java')
    const saveReq = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/organization/vo/SalesOrganizationSaveReqVO.java')
    const resp = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/organization/vo/SalesOrganizationRespVO.java')
    const crm = read(javaRoot, 'erp-module-crm/erp-module-crm-biz/src/main/java/com/wdbc/erp/module/crm/crm/modules/sys/controller/OfficeVueController.java')
    for (const fragment of ['@RequestMapping("/sales/organization")', '@GetMapping("/page")', '@GetMapping("/export")', '@GetMapping("/tree")', '@GetMapping("/detail/{id}")', '@PutMapping("/update")', '@PostMapping("/batch-disable")', 'return success(true)']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private String salesId', 'private String salesCode', 'private Integer salesType', 'private String salesParentId', 'private String salesParentIds', 'private Integer salesGrade', 'private String salesMaster', 'private Integer salesStatus', 'private String groupSalesAreaCodes', 'private String salesBusiness']) expect(saveReq).toContain(fragment)
    for (const fragment of ['private List<Long> ids', 'private String salesCode', 'private Integer salesType', 'private Integer salesStatus', 'private Boolean isSalesTree', 'private Boolean isNeedUsers']) expect(pageReq).toContain(fragment)
    for (const fragment of ['private Long id', 'private String salesId', 'private String salesParentId', 'private String defaultSalesParentId', 'private String groupSalesAreaCodes', 'private String salesBusiness']) expect(resp).toContain(fragment)
    for (const fragment of ['checkOfficeCode', 'String oldCode, String code', 'return true', 'return false']) expect(crm).toContain(fragment)
  })

  it('列表带Portal公共排序字段、默认启用状态和受控分页', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ parentId: 10, name: '总部', salesType: 1, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/sales/organization/page',
      method: 'get',
      params: { order: '', orderField: '', parentId: 10, name: '总部', code: '', salesCode: '', salesType: 1, salesStatus: 1, pageNo: 2, pageSize: 50 },
      httpInstance: 'platform',
    })
    const empty = fixture([{ list: [], total: 0 }])
    await expect(empty.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(empty.calls).toHaveLength(1)
  })

  it('字典、三种树和CRM编码校验逐一使用Portal实际请求', async () => {
    const f = fixture([
      { list: [{ value: '1', label: '启用' }] },
      { list: [{ value: '2', label: '一级' }] },
      { list: [{ value: '3', label: '销售组' }] },
      [{ id: 10, name: '总部', children: [] }],
      [{ id: 10, name: '总部', salesId: 'S-10', children: [] }],
      [{ id: 10, name: '总部', children: [], users: [{ id: 88, realName: '负责人', children: [] }] }],
      { children: [{ value: 'B1', label: '业务', children: [] }] },
      true,
    ])
    await expect(f.api.statusOptions()).resolves.toEqual([{ value: 1, label: '启用' }])
    await expect(f.api.gradeOptions()).resolves.toEqual([{ value: 2, label: '一级' }])
    await expect(f.api.typeOptions()).resolves.toEqual([{ value: 3, label: '销售组' }])
    await expect(f.api.organizationTree()).resolves.toEqual([{ id: 10, name: '总部', children: [] }])
    await expect(f.api.salesTree()).resolves.toEqual([{ id: 10, name: '总部', salesId: 'S-10', children: [] }])
    await expect(f.api.primaryPersonTree()).resolves.toMatchObject([{ id: 10, disabled: true, children: [{ id: 88, name: '负责人' }] }])
    await expect(f.api.businessTree()).resolves.toEqual([{ value: 'B1', label: '业务', children: [] }])
    await expect(f.api.checkCode({ code: 'SALES-001', oldCode: 'OLD-001' })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/system/dict-data/page', method: 'get', params: { dictType: 'sales_organization_status', pageNo: 1, pageSize: 100 }, httpInstance: 'platform' },
      { url: '/admin-api/system/dict-data/page', method: 'get', params: { dictType: 'sys_office_grade', pageNo: 1, pageSize: 100 }, httpInstance: 'platform' },
      { url: '/admin-api/system/dict-data/page', method: 'get', params: { dictType: 'sys_office_type', pageNo: 1, pageSize: 100 }, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/tree', method: 'get', params: { isSalesTree: false }, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/tree', method: 'get', params: {}, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/tree', method: 'get', params: { isNeedUsers: true, isSalesTree: false }, httpInstance: 'platform' },
      { url: '/admin-api/sales/item/getShopCategoryItemTree', method: 'get', httpInstance: 'platform' },
      { url: '/vue/sys/office/checkOfficeCode', method: 'get', params: { code: 'SALES-001', oldCode: 'OLD-001' }, httpInstance: 'crm' },
    ])
  })

  it('详情、编码未修改短路和salesType=3编辑提交严格裁剪/连接字段', async () => {
    const f = fixture([row, true])
    await expect(f.api.get({ id: 10 })).resolves.toEqual(row)
    await expect(f.api.checkCode({ code: 'SALES-001', oldCode: 'SALES-001' })).resolves.toBe(true)
    expect(f.calls).toHaveLength(1)
    const prepared = f.api.prepareUpdate({ form: {
      ...row,
      salesParentId: 'S-20',
      salesType: 3,
      salesStatus: 1,
      salesMaster: 88,
      groupSalesAreaCodes: [100, '200'],
      groupSalesBusinessCodes: ['B1', 2],
      name: '不可提交',
      code: '不可提交',
      parentId: 99,
      remarks: '不可提交',
    } })
    expect(prepared).toEqual({ draft: {
      id: 10,
      salesId: 'S-10',
      salesCode: 'SALES-001',
      salesType: 3,
      salesParentId: 'S-20',
      salesStatus: 1,
      salesMaster: 88,
      salesParentIds: '0',
      salesGrade: 2,
      groupSalesAreaCodes: '100,200',
      salesBusiness: 'B1,2',
    } })
    expect(f.calls).toHaveLength(1)
  })

  it('非3类型省略两个条件字段，写链固定为prepare→submit且回执必须true', async () => {
    const f = fixture([true, true, true, { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="机构.xls"' } }])
    const prepared = f.api.prepareUpdate({ form: { ...row, salesType: 1, salesParentId: 'S-20', groupSalesAreaCodes: [1], groupSalesBusinessCodes: ['B1'] } })
    expect(prepared.draft).not.toHaveProperty('groupSalesAreaCodes')
    expect(prepared.draft).not.toHaveProperty('salesBusiness')
    await expect(f.api.update({ draft: prepared.draft })).resolves.toBeUndefined()
    const stop = f.api.prepareStop({ id: 10, currentFilterStatus: 1 })
    await expect(f.api.stop(stop)).resolves.toBeUndefined()
    const batch = f.api.prepareBatchStop({ ids: [10, '11'], currentFilterStatus: '1' })
    await expect(f.api.batchStop(batch)).resolves.toBeUndefined()
    await expect(f.api.export({ name: '总部', pageNo: 3, pageSize: 20 })).resolves.toMatchObject({ fileName: '机构.xls', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
    expect(f.calls).toEqual([
      { url: '/admin-api/sales/organization/update', method: 'put', data: prepared.draft, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/update', method: 'put', data: { id: 10, salesStatus: 2 }, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/batch-disable', method: 'post', headers: { 'content-type': 'application/json;charset=UTF-8' }, data: [10, '11'], httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/export', method: 'get', params: { parentId: '', name: '总部', code: '', salesCode: '', salesType: '', salesStatus: 1, pageNo: 3, pageSize: 20 }, responseType: 'arraybuffer', httpInstance: 'platform' },
    ])
  })

  it('Portal表单校验、停用可见条件、重复ID和坏回执不能被放松', async () => {
    const f = fixture([])
    expect(() => f.api.prepareUpdate({ form: { ...row, salesParentId: 'S-10' } })).toThrow('自己')
    expect(() => f.api.prepareUpdate({ form: { ...row, salesCode: '' } })).toThrow('salesCode')
    expect(() => f.api.prepareUpdate({ form: { ...row, salesParentId: '' } })).toThrow('salesParentId')
    expect(() => f.api.prepareStop({ id: 10, currentFilterStatus: 2 })).toThrow('启用状态')
    expect(() => f.api.prepareBatchStop({ ids: [10, 10], currentFilterStatus: 1 })).toThrow('重复')
    expect(() => f.api.prepareBatchStop({ ids: [], currentFilterStatus: 1 })).toThrow('至少')
    expect(f.calls).toHaveLength(0)
    await expect(fixture([false]).api.update({ draft: { ...row, salesParentId: 'S-20', salesType: 1, salesStatus: 1, salesMaster: 88 } as never })).rejects.toThrow('响应不是true')
    await expect(fixture([new Uint8Array([])]).api.export()).rejects.toThrow('二进制')
  })

  it('AI说明覆盖所有方法并包含表单映射、权限、失败处理和恢复步骤', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SALE_SYS_OFFICE_METHODS).sort())
    expect(contracts['sale-sys-office-prepare-update']?.steps.some(step => step.capabilityId === 'sale-sys-office-check-code')).toBe(true)
    expect(contracts['sale-sys-office-prepare-update']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['sale-sys-office-update']?.completion).toContain('重新查询')
    expect(contracts['sale-sys-office-batch-stop']?.boundaries.join(' ')).toContain(SALE_SYS_OFFICE_STOP_BATCH_PERMISSION)
    expect(contracts['sale-sys-office-export']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['base64', 'byteLength']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
    const catalog = createCatalog({ capabilities: saleSysOfficeCapabilities })
    expect(catalog.describe('sale-sys-office-list')).toMatchObject({ ok: true })
    expect(catalog.describe('sale-sys-office-list-llm')).toMatchObject({ ok: true })
  })
})
