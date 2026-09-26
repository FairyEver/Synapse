import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingOpeningSupplierCapability,
  financeSettingOpeningSupplierCapabilities,
  FINANCE_SETTING_OPENING_SUPPLIER_METHODS,
  FINANCE_SETTING_OPENING_SUPPLIER_MODULE_TYPE,
  FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH,
  FINANCE_SETTING_OPENING_SUPPLIER_PERMISSION,
  type FinanceSettingOpeningSupplierRow,
} from '../src/capabilities/finance-setting-opening-supplier.js'
import {
  FINANCE_SETTING_OPENING_SUPPLIER_AI_CONTRACTS as contracts,
  FINANCE_SETTING_OPENING_SUPPLIER_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-opening-supplier.js'

type RequestConfig = Parameters<PortalRequest>[0]

/** 本包根目录：测试自读 `generated/` 时用它定位，不写死本机绝对路径。 */
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingOpeningSupplierCapability(request), calls }
}

const row: FinanceSettingOpeningSupplierRow = {
  id: '9007199254740993',
  partyType: 'SUPPLIER',
  companyId: '1001',
  companyName: '北京法人公司',
  accountingSetId: '2001',
  code: 'A001',
  name: '示例客商',
  status: 0,
  detail: '详情',
  categoryCode: '2202',
  categoryId: '3001',
  categoryName: '供应商',
  originalCompanyUpdate: true,
  originalPartyId: '4001',
  originalPartyName: '原客商',
  bankAccounts: [{ id: '5001', bankId: '6001', bankCode: 'ICBC', bankName: '工商银行', bankBranchName: '北京支行', bankAccount: '123456', bankDescription: null }],
  referenced: false,
  remark: '备注',
  supplyChainFinance: true,
  createTime: '2026-09-25 10:00:00',
  updateTime: '2026-09-25 10:01:00',
}

describe('系统设置→财务设置→客商基础档案页面能力', () => {
  it('逐页核对菜单、页面、按钮权限、表单规则和可达接口', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portal, 'app/portal/menus/finance.js')
    const list = read(portal, 'app/portal/views/dashboard/finance/setting/components/business-partner-list.vue')
    const entry = read(portal, 'app/portal/views/dashboard/finance/setting/opening-supplier/list.vue')
    const form = read(portal, 'app/portal/views/dashboard/finance/setting/opening-supplier/[mode]/[id].vue')
    const detail = read(portal, 'app/portal/views/dashboard/finance/setting/opening-supplier/detail/[id].vue')

    expect(menu).toContain(`path: '${FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${FINANCE_SETTING_OPENING_SUPPLIER_PERMISSION}'`)
    expect(entry).toContain('<business-partner-list/>')
    for (const fragment of [
      "const BUSINESS_PARTNER_BASE_URL = '/admin-api/finance/party'",
      "http.post(`${BUSINESS_PARTNER_BASE_URL}/page`, params)",
      "http.put(`${BUSINESS_PARTNER_BASE_URL}/change-status`, data)",
      "http.delete(`${BUSINESS_PARTNER_BASE_URL}/delete`, { params: { id } })",
      "http.get(`${BUSINESS_PARTNER_BASE_URL}/category-options`)",
      "http.get(`${BUSINESS_PARTNER_BASE_URL}/template`, { responseType: 'blob' })",
      "http.post(`${BUSINESS_PARTNER_BASE_URL}/import`",
      "http.post(`${BUSINESS_PARTNER_BASE_URL}/export`, params, { responseType: 'blob' })",
      "create: 'finance:setting:business-partner:create'",
      "update: 'finance:setting:business-partner:update'",
      "delete: 'finance:setting:business-partner:delete'",
      "import: 'finance:setting:business-partner:import'",
      "export: 'finance:setting:business-partner:export'",
      'styleV2: true',
      '20 * 1024 * 1024',
      'buildFilterPayload',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "http.get(`${BUSINESS_PARTNER_BASE_URL}/get`",
      "http.post(`${BUSINESS_PARTNER_BASE_URL}/create`",
      "http.put(`${BUSINESS_PARTNER_BASE_URL}/update`",
      "http.get(`${BUSINESS_PARTNER_BASE_URL}/original-options`",
      "http.get(`${BUSINESS_PARTNER_BASE_URL}/generate-code`",
      ':maxlength="500"',
      ':maxlength="50"',
      'originalCompanyUpdate',
      'validateBankAccounts',
      'originalPartyId',
    ]) expect(form).toContain(fragment)
    expect(detail).toContain("http.get(`${BUSINESS_PARTNER_BASE_URL}/get`")
    expect(financeSettingOpeningSupplierCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_OPENING_SUPPLIER_METHODS))
    expect(financeSettingOpeningSupplierCapabilities.every(item => item.pagePath === FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH && item.permission === FINANCE_SETTING_OPENING_SUPPLIER_PERMISSION && item.moduleType === FINANCE_SETTING_OPENING_SUPPLIER_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingOpeningSupplierCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'finance-setting-opening-supplier-create',
      'finance-setting-opening-supplier-update',
      'finance-setting-opening-supplier-change-status',
      'finance-setting-opening-supplier-delete',
      'finance-setting-opening-supplier-import',
    ])
  })

  it('逐页核对Java控制器、VO和服务端整批规则', () => {
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const base = 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/party'
    const controller = read(java, `${base}/FinancePartyController.java`)
    const page = read(java, `${base}/vo/FinancePartyPageReqVO.java`)
    const save = read(java, `${base}/vo/FinancePartySaveReqVO.java`)
    const bank = read(java, `${base}/vo/FinancePartyBankAccountSaveReqVO.java`)
    const response = read(java, `${base}/vo/FinancePartyRespVO.java`)
    const service = read(java, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/party/FinancePartyServiceImpl.java')
    const excelService = read(java, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/party/FinancePartyExcelServiceImpl.java')
    const catalog = JSON.parse(read(packageRoot, 'generated/page-catalog.json')) as { items: Array<Record<string, unknown>> }
    for (const fragment of [
      '@RequestMapping("/finance/party")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")',
      '@GetMapping("/get")', '@PostMapping("/page")', '@GetMapping("/generate-code")', '@PutMapping("/change-status")',
      '@GetMapping("/company-tree")', '@GetMapping("/category-options")', '@GetMapping("/original-options")',
      '@GetMapping("/template")', '@PostMapping("/import")', '@PostMapping("/export")',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['private String code', 'private String name', 'private List<Long> companyIds', 'private Integer status', 'private Boolean supplyChainFinance']) expect(page).toContain(fragment)
    for (const fragment of ['@NotBlank', '@Size(max = 500', '@Pattern(regexp = "^[A-Za-z0-9]*$", message', 'private Long companyId', 'private Boolean originalCompanyUpdate', 'private List<FinancePartyBankAccountSaveReqVO> bankAccounts']) expect(save).toContain(fragment)
    for (const fragment of ['private Long bankId', '@Size(max = 500', '@Size(max = 50', '@Pattern(regexp = "^\\\\d*$", message']) expect(bank).toContain(fragment)
    for (const fragment of ['private String companyName', 'private String categoryName', 'private Boolean originalCompanyUpdate', 'private List<FinancePartyBankAccountRespVO> bankAccounts', 'private Boolean supplyChainFinance']) expect(response).toContain(fragment)
    for (const fragment of ['validateFile', 'importRows', 'MAX_IMPORT_FILE_SIZE', 'errors']) expect(excelService).toContain(fragment)
    expect(service).toContain('financePartyBankAccountService.replaceAccounts')
    expect(catalog.items.find(item => item.menuPath === FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH)).toMatchObject({
      title: '客商基础档案', permission: FINANCE_SETTING_OPENING_SUPPLIER_PERMISSION, moduleType: null,
      routeFile: 'app/portal/views/dashboard/finance/setting/opening-supplier/list.vue',
    })
  })

  it('逐字段复现默认列表、候选、详情、公司树和编码请求', async () => {
    const companyTree = [{ id: '1001', pid: null, name: '法人公司', fullName: '集团/法人公司', isCorporation: 1, children: [] }]
    const f = fixture([{ list: [row], total: 1 }, { list: [row], total: 1 }, [{ id: 3001, code: '2202', name: '供应商' }], companyTree, row, [{ id: 4001, sourceType: 'PARTY', companyId: 1001, companyName: '法人公司', code: 'A000', name: '原客商', status: 0, originalPartyId: null, bankAccounts: [] }], 'A002'])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.list({ name: '示例', code: 'A', categoryCode: '2202', companyIds: ['1001'], status: 1, supplyChainFinance: true, pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    await expect(f.api.listCategoryOptions()).resolves.toEqual([{ id: 3001, code: '2202', name: '供应商' }])
    await expect(f.api.companyTree()).resolves.toEqual(companyTree.map(({ pid: _pid, ...item }) => ({ ...item, parentId: null })))
    await expect(f.api.get({ id: row.id })).resolves.toEqual(row)
    await expect(f.api.originalOptions({ companyId: '1001', excludeId: row.id, keyword: '原' })).resolves.toHaveLength(1)
    await expect(f.api.originalOptions({ keyword: '   ' })).rejects.toThrow('关键字')
    await expect(f.api.generateCode({ companyId: '1001' })).resolves.toBe('A002')
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/party/page', method: 'post', data: { order: '', orderField: '', name: '', code: '', companyIds: [], status: 0, pageNo: 1, pageSize: 20 } })
    expect(f.calls[1]?.data).toMatchObject({ order: '', orderField: '', name: '示例', code: 'A', categoryCode: '2202', companyIds: ['1001'], status: 1, supplyChainFinance: true, pageNo: 2, pageSize: 50 })
    expect(f.calls.at(-2)).toEqual({ url: '/admin-api/finance/party/original-options', method: 'get', params: { keyword: '原', companyId: '1001', excludeId: row.id } })
    expect(f.calls.at(-1)).toEqual({ url: '/admin-api/finance/party/generate-code', method: 'get', params: { companyId: '1001' } })
  })

  it('严格复现创建、编辑、启停和删除的表单载荷与回执', async () => {
    const createInput = {
      name: '新客商', code: 'B001', autoAssignCode: false, companyId: '1001', categoryCode: '2202',
      originalCompanyUpdate: true, originalPartyId: '4001', supplyChainFinance: true,
      bankAccounts: [{ bankId: '6001', bankBranchName: '支行', bankAccount: '123456' }, { bankId: null, bankBranchName: '', bankAccount: '' }],
      status: 0 as const, detail: '明细', remark: '备注',
    }
    const f = fixture([9001, true, true, true])
    const createDraft = f.api.prepareCreate(createInput).draft
    await expect(f.api.create({ draft: createDraft })).resolves.toBe(9001)
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/party/create', method: 'post', data: createDraft })
    const update = f.api.prepareUpdate({ current: row, changes: { categoryCode: '2203', supplyChainFinance: false, bankAccounts: [{ bankId: '6002', bankAccount: '999' }] } })
    expect(update.previous.id).toBe(row.id)
    await expect(f.api.update({ draft: update.draft })).resolves.toBe(true)
    expect(f.calls[1]).toMatchObject({ url: '/admin-api/finance/party/update', method: 'put', data: update.draft })
    const status = f.api.prepareChangeStatus({ id: row.id, status: 1 })
    await expect(f.api.changeStatus(status)).resolves.toBe(true)
    expect(f.calls[2]).toEqual({ url: '/admin-api/finance/party/change-status', method: 'put', data: { id: row.id, status: 1 } })
    const deletion = f.api.prepareDelete({ id: row.id })
    await expect(f.api.delete(deletion)).resolves.toBe(true)
    expect(f.calls[3]).toEqual({ url: '/admin-api/finance/party/delete', method: 'delete', params: { id: row.id } })
    expect(Object.keys(f.calls[1]!.data as object)).not.toContain('companyName')
    expect(Object.keys(f.calls[1]!.data as object)).not.toContain('categoryName')
    expect(Object.keys(f.calls[1]!.data as object)).not.toContain('originalPartyName')
  })

  it('覆盖模板、导入multipart和导出筛选；文件边界在请求前失败', async () => {
    const content = Buffer.from('xlsx-fixture')
    const file = { fileName: '客商.xlsx', base64: content.toString('base64') }
    const binary = { data: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength), headers: { 'content-type': 'application/vnd.ms-excel' } }
    const f = fixture([binary, 2, binary])
    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '客商基础档案导入模板.xlsx', byteLength: content.byteLength })
    await expect(f.api.importFile(file)).resolves.toBe(2)
    const importData = f.calls[1]?.data as FormData
    expect(importData).toBeInstanceOf(FormData)
    expect((importData.get('file') as File).name).toBe('客商.xlsx')
    await expect(f.api.export({ name: '示例', status: 0 })).resolves.toMatchObject({ fileName: '客商基础档案.xlsx', byteLength: content.byteLength })
    expect(f.calls[2]).toEqual({ url: '/admin-api/finance/party/export', method: 'post', data: { name: '示例', code: '', companyIds: [], status: 0 } , responseType: 'arraybuffer' })
    const noCall = fixture()
    expect(() => noCall.api.prepareImport({ fileName: '客商.csv', base64: content.toString('base64') })).toThrow('扩展名')
    expect(() => noCall.api.prepareImport({ fileName: '客商.xlsx', base64: 'not-base64' })).toThrow('Base64')
    expect(() => noCall.api.prepareCreate({ ...file, name: 'x', companyId: '1', originalCompanyUpdate: false, code: 'B001' } as never)).not.toThrow()
    expect(() => noCall.api.prepareCreate({ name: 'x', code: '含中文', companyId: '1', originalCompanyUpdate: false })).toThrow('字母和数字')
    expect(() => noCall.api.prepareCreate({ name: 'x', code: 'B001', companyId: '1', originalCompanyUpdate: true })).toThrow('originalPartyId')
    expect(() => noCall.api.prepareCreate({ name: 'x', code: 'B001', companyId: '1', originalCompanyUpdate: false, bankAccounts: [{ bankId: null, bankAccount: '1' }] })).toThrow('选择所属银行')
    expect(noCall.calls).toHaveLength(0)
  })

  it('AI契约逐方法登记并用反证锁定关键字段和映射', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: financeSettingOpeningSupplierCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_OPENING_SUPPLIER_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_OPENING_SUPPLIER_METHODS).map(method => `financeSettingOpeningSupplier.${method}`))
    expect(contracts['finance-setting-opening-supplier-list']?.output.fields.some(item => item.path === 'list[].status')).toBe(true)
    expect(contracts['finance-setting-opening-supplier-update']?.steps.some(step => step.mapping?.id === 'args.draft.id')).toBe(true)
    expect(contracts['finance-setting-opening-supplier-prepare-create']?.steps.some(step => step.mapping?.draft === 'result.draft')).toBe(true)
    const broken = structuredClone(contracts)
    broken['finance-setting-opening-supplier-list']!.output.fields = broken['finance-setting-opening-supplier-list']!.output.fields.filter(item => item.path !== 'list[].id')
    expect(validateAiContracts(broken, { definitions: financeSettingOpeningSupplierCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
