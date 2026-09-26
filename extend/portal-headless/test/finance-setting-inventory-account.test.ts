import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingInventoryAccountCapability,
  financeSettingInventoryAccountCapabilities,
  FINANCE_SETTING_INVENTORY_ACCOUNT_METHODS,
  FINANCE_SETTING_INVENTORY_ACCOUNT_PAGE_PATH,
  type FinanceSettingInventoryAccountRow,
} from '../src/capabilities/finance-setting-inventory-account.js'
import {
  FINANCE_SETTING_INVENTORY_ACCOUNT_AI_CONTRACTS as contracts,
  FINANCE_SETTING_INVENTORY_ACCOUNT_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-inventory-account.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceSettingInventoryAccountRow = {
  id: '9007199254740993',
  materialCategoryId: '100',
  materialCategoryIds: ['100', '101'],
  materialCategoryName: '原料/玉米',
  materialId: '200',
  materialCode: 'MAT-001',
  materialName: '玉米',
  adjustmentTypeId: 'INBOUND_1',
  adjustmentTypeLabel: '采购入库',
  adjustmentCategoryName: '入库',
  outboundUseType: 'SALE',
  outboundUseTypeName: '销售出库',
  inventoryAccountId: '300',
  inventoryAccountCode: '1401',
  inventoryAccountName: '库存商品',
  counterpartAccountId: '400',
  counterpartAccountCode: '2202',
  counterpartAccountName: '应付账款',
  useOrgAttribute: 1,
  useOrgAttributeName: '是',
  status: 1,
  statusName: '启用',
  remark: '测试配置',
  creator: 'tester',
  createTime: '2026-09-24 10:00:00',
  updater: 'tester',
  updateTime: '2026-09-24 10:10:00',
  editable: true,
  deletable: true,
  statusChangeable: true,
  disableReason: null,
}

const createInput = {
  materialCategoryIds: ['100'],
  materialId: row.materialId!,
  materialCode: row.materialCode!,
  materialName: row.materialName!,
  inventoryUnitOrgId: '500',
  unitType: ['STANDARD'],
  adjustmentTypeId: row.adjustmentTypeId!,
  outboundUseType: row.outboundUseType!,
  inventoryAccountId: row.inventoryAccountId!,
  inventoryAccountCode: row.inventoryAccountCode!,
  counterpartAccountId: row.counterpartAccountId!,
  counterpartAccountCode: row.counterpartAccountCode!,
  counterpartAccountName: row.counterpartAccountName!,
  useOrgAttribute: 1 as const,
  status: null,
  remark: row.remark!,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingInventoryAccountCapability(request), calls }
}

describe('财务设置→存货科目配置页面能力', () => {
  it('逐页静态核对菜单、路由、按钮权限、端点、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/inventory-account.vue'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/inventory-account/list.vue'), 'utf8')
    const form = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/inventory-account/[mode]/[id].vue'), 'utf8')
    const materialSelect = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/inventory-account/components/material-select.vue'), 'utf8')
    const categoryTree = readFileSync(join(portalRoot, 'app/portal/components/portal/supply/tree-select/material-category/index.vue'), 'utf8')
    const adjustmentTree = readFileSync(join(portalRoot, 'app/portal/components/portal/finance/adjustment-type-tree/index.vue'), 'utf8')
    const controllerPath = join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/inventoryaccountconfig/InventoryAccountConfigController.java')
    const voDir = join(javaRoot, 'erp-module-finance/erp-module-finance-api/src/main/java/com/wdbc/erp/module/finance/inventoryaccountconfig/vo')
    const controller = readFileSync(controllerPath, 'utf8')
    const createReq = readFileSync(join(voDir, 'InventoryAccountConfigCreateReqVO.java'), 'utf8')
    const updateReq = readFileSync(join(voDir, 'InventoryAccountConfigUpdateReqVO.java'), 'utf8')
    const pageReq = readFileSync(join(voDir, 'InventoryAccountConfigPageReqVO.java'), 'utf8')
    const response = readFileSync(join(voDir, 'InventoryAccountConfigRespVO.java'), 'utf8')
    const importResponse = readFileSync(join(voDir, 'InventoryAccountConfigImportRespVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/inventoryaccountconfig/InventoryAccountConfigServiceImpl.java'), 'utf8')

    expect(menu).toContain(`path: '${FINANCE_SETTING_INVENTORY_ACCOUNT_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/finance/setting/inventory-account'")
    expect(route).toContain('permission: /dashboard/finance/setting/inventory-account')
    expect(list).toContain("customLoad: async (params)")
    expect(list).toContain("http.get('/admin-api/finance/inventory-config/page'")
    for (const endpoint of ['/admin-api/supply/materiel-category/tree', '/admin-api/finance/inventory-config/adjustment-type-tree', '/admin-api/supply/materiel/page', '/admin-api/finance/inventory-config/export-excel', '/admin-api/finance/inventory-config/import-template', '/admin-api/finance/inventory-config/import-excel']) {
      expect(`${list}\n${materialSelect}\n${categoryTree}\n${adjustmentTree}`).toContain(endpoint)
    }
    for (const permission of ['finance:setting:inventory-account:export', 'finance:setting:inventory-account:edit', 'finance:setting:inventory-account:create', 'finance:setting:inventory-account:status']) expect(list).toContain(permission)
    expect(list).toContain('styleV2: true')
    expect(materialSelect).toContain('pageSizeOptions: [')
    for (const queryField of ['materialCategoryIds', 'materialCode', 'materialName', 'inventoryAccountIds', 'adjustmentTypeIds', 'outboundUseType', 'counterpartAccountIds', 'useOrgAttribute', 'status']) expect(list).toContain(`${queryField}:`)
    for (const column of ['materialCategoryName', 'materialCode', 'materialName', 'inventoryAccountCode', 'inventoryAccountName', 'adjustmentTypeLabel', 'outboundUseType', 'counterpartAccountCode', 'counterpartAccountName', 'useOrgAttribute', 'statusName']) expect(list).toContain(`dataIndex: '${column}'`)
    expect(list).toContain('materialCategoryIds: editingRow.materialCategoryIds')
    expect(list).toContain('adjustmentTypeId: normalizeSingleValue(editingRow.adjustmentTypeId)')
    expect(list).toContain("http.put('/admin-api/finance/inventory-config/update'")
    expect(list).toContain("http.post('/admin-api/finance/inventory-config/create'")
    expect(list).toContain('const status = record.status === 1 ? 0 : 1')
    expect(list).toContain('update-status?id=${record.id}&status=${status}')
    expect(list).toContain("input.accept = '.xml,.xlsx,.xls'")
    expect(list).toContain("data.append('file'")
    expect(materialSelect).toContain("getDataListURL: '/admin-api/supply/materiel/page'")
    expect(materialSelect).toContain('status: 1')
    expect(materialSelect).toContain("pageSizeOptions: ['10', '50', '100', '500']")
    expect(categoryTree).toContain("http('/admin-api/supply/materiel-category/tree')")
    expect(categoryTree).toContain("label: 'catName'")
    expect(adjustmentTree).toContain("http('/admin-api/finance/inventory-config/adjustment-type-tree')")
    expect(adjustmentTree).toContain("label: 'label'")
    expect(form).not.toContain('customLoad')
    expect(form).toContain('materialCategoryId')

    expect(controller).toContain('@RequestMapping("/finance/inventory-config")')
    for (const endpoint of ['@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")', '@GetMapping("/import-template")', '@PostMapping("/import-excel")', '@PutMapping("/update-status")', '@GetMapping("/adjustment-type-tree")', '@GetMapping("/material-category-tree")']) expect(controller).toContain(endpoint)
    expect(createReq).toContain('private List<Long> materialCategoryIds')
    expect(createReq).toContain('@NotBlank(message = "存货调整类型ID不能为空")')
    expect(createReq).toContain('private Long inventoryAccountId')
    expect(createReq).toContain('private Long counterpartAccountId')
    expect(updateReq).toContain('extends InventoryAccountConfigCreateReqVO')
    for (const field of ['materialCategoryIds', 'materialName', 'materialCode', 'adjustmentTypeIds', 'inventoryAccountIds', 'counterpartAccountIds', 'useOrgAttribute', 'status']) expect(pageReq).toContain(field)
    for (const field of ['materialCategoryIds', 'adjustmentTypeLabel', 'outboundUseTypeName', 'inventoryAccountCode', 'counterpartAccountName', 'statusName', 'editable', 'deletable', 'disableReason']) expect(response).toContain(field)
    for (const field of ['totalCount', 'successCount', 'failureCount', 'errorMessages']) expect(importResponse).toContain(field)
    expect(service).toContain('status = 1')
    expect(service).toContain('validateDuplicate')
    expect(service).toContain('已按存货科目配置生成凭证，不允许编辑或删除，可停用')
    expect(service).toContain('存货科目配置导入模板.xlsx')
    expect(service).toContain('useOrgAttributeValue')
    expect(financeSettingInventoryAccountCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_INVENTORY_ACCOUNT_METHODS))
    expect(financeSettingInventoryAccountCapabilities.every(item => item.pagePath === FINANCE_SETTING_INVENTORY_ACCOUNT_PAGE_PATH && item.permission === '/dashboard/finance/setting/inventory-account' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingInventoryAccountCapabilities.find(item => item.id === 'finance-setting-inventory-account-create')?.write).toBe(true)
    expect(financeSettingInventoryAccountCapabilities.find(item => item.id === 'finance-setting-inventory-account-list')?.write).toBe(false)
  })

  it('默认列表请求逐字段复刻Portal pageSize、空数组拼接和null筛选规则', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/inventory-config/page',
      method: 'get',
      params: {
        pageNo: 1,
        pageSize: 20,
        materialCategoryIds: '',
        materialCode: null,
        materialName: null,
        inventoryAccountIds: '',
        adjustmentTypeIds: null,
        outboundUseType: null,
        counterpartAccountIds: '',
        useOrgAttribute: null,
        status: null,
      },
    })

    const filtered = fixture([{ list: [], total: 0 }])
    await expect(filtered.api.list({ materialCategoryIds: ['100', '101'], materialCode: 'MAT', materialName: '玉米', inventoryAccountIds: ['300'], adjustmentTypeIds: ['INBOUND_1', 'OUTBOUND_2'], outboundUseType: 'SALE', counterpartAccountIds: ['400'], useOrgAttribute: 1, status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(filtered.calls[0]?.params).toEqual({
      pageNo: 2,
      pageSize: 50,
      materialCategoryIds: '100,101',
      materialCode: 'MAT',
      materialName: '玉米',
      inventoryAccountIds: '300',
      adjustmentTypeIds: 'INBOUND_1,OUTBOUND_2',
      outboundUseType: 'SALE',
      counterpartAccountIds: '400',
      useOrgAttribute: 1,
      status: 0,
    })
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
  })

  it('严格投影分类树、调整类型树和物料候选，并保留长ID', async () => {
    const categoryTree = [{ id: '100', catName: '原料', extra: 'ignored', children: [{ id: '101', catName: '谷物', children: [] }] }]
    const adjustmentTree = [{ id: 'INBOUND_1', label: '采购入库', value: 'INBOUND_1', children: [] }]
    const material = { id: '9007199254740993', matCode: 'MAT-001', matName: '玉米', status: 1, catNameCombination: '原料/谷物', hiddenBackendField: 'not exposed' }
    const visibleMaterial = { id: material.id, matCode: material.matCode, matName: material.matName, status: material.status, catNameCombination: material.catNameCombination }
    const f = fixture([categoryTree, adjustmentTree, { list: [material], total: 1 }])
    await expect(f.api.materialCategoryTree()).resolves.toEqual(categoryTree)
    await expect(f.api.adjustmentTypeTree()).resolves.toEqual(adjustmentTree)
    await expect(f.api.searchMaterials({ categoryIds: ['100'], matCode: ' MAT ', matName: '玉米', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [visibleMaterial], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/admin-api/supply/materiel-category/tree', method: 'get' })
    expect(f.calls[1]).toEqual({ url: '/admin-api/finance/inventory-config/adjustment-type-tree', method: 'get' })
    expect(f.calls[2]).toEqual({ url: '/admin-api/supply/materiel/page', method: 'get', params: { order: '', orderField: '', matName: '玉米', type: null, matCode: ' MAT ', categoryIds: '100', status: 1, pageNo: 2, pageSize: 50 } })
    await expect(f.api.searchMaterials({ categoryIds: [] })).rejects.toThrow('categoryIds')
    await expect(fixture([[{ id: 'x', catName: 'bad', children: [] }]]).api.materialCategoryTree()).rejects.toThrow('id')
  })

  it('创建复刻Portal完整行内载荷并默认启用', async () => {
    const f = fixture([row.id])
    const prepared = f.api.prepareCreate(createInput)
    expect(prepared).toEqual({
      draft: {
        materialCategoryIds: ['100'],
        materialId: row.materialId,
        materialCode: row.materialCode,
        materialName: row.materialName,
        inventoryUnitOrgId: '500',
        unitType: 'STANDARD',
        adjustmentTypeId: row.adjustmentTypeId,
        outboundUseType: row.outboundUseType,
        inventoryAccountId: row.inventoryAccountId,
        inventoryAccountCode: row.inventoryAccountCode,
        counterpartAccountId: row.counterpartAccountId,
        counterpartAccountCode: row.counterpartAccountCode,
        counterpartAccountName: row.counterpartAccountName,
        useOrgAttribute: 1,
        status: 1,
        remark: row.remark,
      },
    })
    await expect(f.api.create(prepared)).resolves.toBe(row.id)
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/inventory-config/create', method: 'post', data: prepared.draft })
    expect(() => f.api.prepareCreate({ ...createInput, materialId: null, materialCategoryIds: [] })).toThrow('物料或至少一个物料分类')
    expect(() => f.api.prepareCreate({ ...createInput, adjustmentTypeId: ' '.repeat(51) })).toThrow('adjustmentTypeId')
    expect(() => f.api.prepareCreate({ ...createInput, counterpartAccountName: '' })).toThrow('counterpartAccountName')
  })

  it('编辑保留完整载荷并按绝对状态启停', async () => {
    const f = fixture([true, true])
    const prepared = f.api.prepareUpdate({ current: row, changes: { counterpartAccountName: '应付账款（新）', remark: '更新' } })
    expect(prepared.draft).toMatchObject({ id: row.id, materialCategoryIds: row.materialCategoryIds, materialId: row.materialId, adjustmentTypeId: row.adjustmentTypeId, counterpartAccountName: '应付账款（新）', status: row.status })
    expect(prepared.previous).toMatchObject({ id: row.id, counterpartAccountName: row.counterpartAccountName, status: row.status })
    await expect(f.api.update(prepared)).resolves.toBe(true)
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/inventory-config/update', method: 'put', data: prepared.draft })
    const statusPrepared = f.api.prepareSetStatus({ current: row, targetStatus: 0 })
    expect(statusPrepared).toEqual({ draft: { id: row.id, status: 0 }, previous: { id: row.id, status: 1 } })
    await expect(f.api.setStatus(statusPrepared)).resolves.toBe(true)
    expect(f.calls[1]).toEqual({ url: '/admin-api/finance/inventory-config/update-status', method: 'put', params: { id: row.id, status: 0 } })
    expect(() => f.api.prepareSetStatus({ current: row, targetStatus: 1 })).toThrow('相反')
    expect(() => f.api.prepareUpdate({ current: { ...row, status: 0 }, changes: { remark: '不允许' } })).not.toThrow()
    await expect(f.api.update({ draft: { ...prepared.draft, status: 2 as never } })).rejects.toThrow('status')
  })

  it('导出、模板和导入遵循Portal文件扩展名、multipart字段与后端回执', async () => {
    const bytes = new TextEncoder().encode('xlsx-content').buffer
    const response = { data: bytes, headers: { 'content-type': 'application/vnd.ms-excel' } }
    const f = fixture([response, { data: bytes, headers: {} }, { totalCount: 2, successCount: 1, failureCount: 1, errorMessages: ['第2行失败'] }])
    await expect(f.api.export({ materialCategoryIds: ['100'], status: 1 })).resolves.toMatchObject({ fileName: '存货科目配置.xls', contentType: 'application/vnd.ms-excel', byteLength: 12, base64: Buffer.from('xlsx-content').toString('base64') })
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/inventory-config/export-excel', method: 'get', params: { materialCategoryIds: '100', materialCode: null, materialName: null, inventoryAccountIds: '', adjustmentTypeIds: null, outboundUseType: null, counterpartAccountIds: '', useOrgAttribute: null, status: 1 }, responseType: 'arraybuffer' })
    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '存货科目配置导入模板.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 12 })
    expect(f.calls[1]).toEqual({ url: '/admin-api/finance/inventory-config/import-template', method: 'get', responseType: 'arraybuffer' })
    const file = { fileName: 'inventory.xlsx', base64: Buffer.from('import-content').toString('base64') }
    expect(f.api.prepareImport(file)).toEqual({ fileName: 'inventory.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 14 })
    await expect(f.api.importFile(file)).resolves.toEqual({ totalCount: 2, successCount: 1, failureCount: 1, errorMessages: ['第2行失败'] })
    const importCall = f.calls[2]!
    expect(importCall).toMatchObject({ url: '/admin-api/finance/inventory-config/import-excel', method: 'post', headers: { 'Content-Type': 'multipart/form-data' } })
    const uploaded = (importCall.data as FormData).get('file') as File
    expect(uploaded.name).toBe('inventory.xlsx')
    expect(() => f.api.prepareImport({ fileName: 'inventory.csv', base64: 'YQ==' })).toThrow('扩展名')
    await expect(fixture([{}]).api.importFile({ fileName: 'inventory.xlsx', base64: 'YQ==' })).rejects.toThrow('totalCount')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.downloadTemplate()).rejects.toThrow('空文件')
  })

  it('坏响应、能力注册和AI契约反证必须失败', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, status: 2 }], total: 1 }]).api.list()).rejects.toThrow('status')
    await expect(fixture([{ list: [{ ...row, materialCategoryIds: ['bad'] }], total: 1 }]).api.list()).rejects.toThrow('materialCategoryIds')
    await expect(fixture([false]).api.update({ draft: { ...row } as never })).rejects.toThrow('不是true')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: financeSettingInventoryAccountCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_INVENTORY_ACCOUNT_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_INVENTORY_ACCOUNT_METHODS).map(method => `financeSettingInventoryAccount.${method}`))
    const broken = structuredClone(contracts)
    const brokenField = broken['finance-setting-inventory-account-create']!.output.fields.find(field => field.path === '$')!
    brokenField.path = 'not a valid path'
    expect(validateAiContracts(broken, { definitions: financeSettingInventoryAccountCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
