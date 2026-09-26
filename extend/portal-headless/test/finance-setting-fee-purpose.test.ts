import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingFeePurposeCapability,
  financeSettingFeePurposeCapabilities,
  FINANCE_SETTING_FEE_PURPOSE_METHODS,
  FINANCE_SETTING_FEE_PURPOSE_PAGE_PATH,
  type FinanceSettingFeePurposeRow,
} from '../src/capabilities/finance-setting-fee-purpose.js'
import {
  FINANCE_SETTING_FEE_PURPOSE_AI_CONTRACTS as contracts,
  FINANCE_SETTING_FEE_PURPOSE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-fee-purpose.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceSettingFeePurposeRow = {
  id: '9007199254740993',
  applicationType: 'transport_expense_request_form',
  applicationTypeName: '外雇车辆费用支出申请单',
  feeCode: '12',
  feeName: '车辆租赁费',
  purpose: '车辆租赁',
  status: 0,
  createTime: '2026-09-23 10:00:00',
  updateTime: '2026-09-24 10:00:00',
}

const disabledRow: FinanceSettingFeePurposeRow = { ...row, status: 1 }

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingFeePurposeCapability(request), calls }
}

describe('财务设置→费用用途管理页面能力', () => {
  it('逐页静态核对菜单、路由、按钮权限、端点、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/fee-purpose.vue'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/fee-purpose/list.vue'), 'utf8')
    const form = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/fee-purpose/[mode]/[id].vue'), 'utf8')
    const utility = readFileSync(join(portalRoot, 'app/portal/utils/finance/fee-purpose.js'), 'utf8')
    const javaDir = join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/feepurpose')
    const controller = readFileSync(join(javaDir, 'FeePurposeController.java'), 'utf8')
    const pageReq = readFileSync(join(javaDir, 'vo/FeePurposePageReqVO.java'), 'utf8')
    const saveReq = readFileSync(join(javaDir, 'vo/FeePurposeSaveReqVO.java'), 'utf8')
    const updateReq = readFileSync(join(javaDir, 'vo/FeePurposeUpdateReqVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/feepurpose/FeePurposeServiceImpl.java'), 'utf8')
    const catalog = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/feepurpose/FeePurposeCatalogService.java'), 'utf8')

    expect(menu).toContain(`path: '${FINANCE_SETTING_FEE_PURPOSE_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/finance/setting/fee-purpose'")
    expect(route).toContain("permission: '/dashboard/finance/setting/fee-purpose'")
    expect(list).toContain("customLoad: loadPage")
    expect(list).toContain("http.get('/admin-api/finance/fee-purpose/page'")
    expect(list).toContain("http.get('/admin-api/finance/fee-purpose/application-type-options'")
    expect(list).toContain("http.get('/admin-api/finance/fee-purpose/fee-options'")
    expect(list).toContain("http.delete('/admin-api/finance/fee-purpose/delete'")
    expect(list).toContain("http.put('/admin-api/finance/fee-purpose/update-status'")
    expect(list).toContain("create: 'finance:fee-purpose:create'")
    expect(list).toContain("update: 'finance:fee-purpose:update'")
    expect(list).toContain("updateStatus: 'finance:fee-purpose:update-status'")
    expect(list).toContain("delete: 'finance:fee-purpose:delete'")
    expect(list).toContain('rrList.pageSize = 10')
    expect(list).toContain('status: 0')
    for (const column of ['applicationTypeName', 'feeName', 'purpose', 'updateTime', 'status']) expect(list).toContain(`dataIndex: '${column}'`)
    expect(list).toContain('record.status === 1 && permissionCheck(permissions.update)')
    expect(list).toContain('record.status === 1 && permissionCheck(permissions.delete)')
    expect(form).toContain("customLoad: (id) => http.get('/admin-api/finance/fee-purpose/get'")
    expect(form).toContain("http.post('/admin-api/finance/fee-purpose/create'")
    expect(form).toContain("feeCode: String(formState.feeCode)")
    expect(form).toContain("http.put('/admin-api/finance/fee-purpose/update'")
    expect(form).toContain('purpose: [{ validator: validateFeePurpose')
    expect(utility).toContain('Array.from(String(value ?? \'\')).length')
    expect(utility).toContain('FEE_PURPOSE_MAX_LENGTH = 15')

    expect(controller).toContain('@RequestMapping("/finance/fee-purpose")')
    for (const endpoint of ['@GetMapping("/page")', '@GetMapping("/get")', '@PostMapping("/create")', '@PutMapping("/update")', '@PutMapping("/update-status")', '@DeleteMapping("/delete")', '@GetMapping("/application-type-options")', '@GetMapping("/fee-options")']) expect(controller).toContain(endpoint)
    expect(pageReq).toContain('private String keyword')
    expect(pageReq).toContain('private String applicationType')
    expect(pageReq).toContain('private String feeCode')
    expect(saveReq).toContain('private String applicationType')
    expect(saveReq).toContain('private String feeCode')
    expect(updateReq).toContain('private Long id')
    expect(service).toContain('purpose.codePoints().count() > 15')
    expect(service).toContain('.eq(FeePurposeDO::getStatus, DISABLED)')
    expect(service).toContain('set(FeePurposeDO::getDeleted, true)')
    expect(catalog).toContain('getApplicationTypeOptions')
    expect(catalog).toContain('getFeeOptions')
    expect(financeSettingFeePurposeCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_FEE_PURPOSE_METHODS))
    expect(financeSettingFeePurposeCapabilities.every(item => item.pagePath === FINANCE_SETTING_FEE_PURPOSE_PAGE_PATH && item.permission === '/dashboard/finance/setting/fee-purpose' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingFeePurposeCapabilities.find(item => item.id === 'finance-setting-fee-purpose-create')?.write).toBe(true)
    expect(financeSettingFeePurposeCapabilities.find(item => item.id === 'finance-setting-fee-purpose-list')?.write).toBe(false)
  })

  it('默认列表请求逐字段复刻Portal pageSize、状态和空筛选规则', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/fee-purpose/page',
      method: 'get',
      params: {
        pageNo: 1,
        pageSize: 10,
        applicationType: undefined,
        feeCode: undefined,
        keyword: undefined,
        status: 0,
      },
    })

    const filtered = fixture([{ list: [], total: 0 }])
    await expect(filtered.api.list({ applicationType: 'transport_expense_request_form', feeCode: '12', keyword: '  车辆  ', status: 'all', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(filtered.calls[0]?.params).toEqual({
      pageNo: 2,
      pageSize: 50,
      applicationType: 'transport_expense_request_form',
      feeCode: '12',
      keyword: '车辆',
    })
  })

  it('严格投影列表详情与级联候选，保留长ID、费用代码和时间原值', async () => {
    const hidden = { ...row, hiddenBackendField: 'not exposed' }
    const f = fixture([{ list: [hidden], total: 1 }, row, [{ value: 'transport_expense_request_form', label: '外雇车辆费用支出申请单' }], [{ value: '12', label: '车辆租赁费' }]])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.get({ id: row.id })).resolves.toEqual(row)
    await expect(f.api.searchApplicationTypes({ keyword: '  车辆  ' })).resolves.toEqual([{ value: 'transport_expense_request_form', label: '外雇车辆费用支出申请单' }])
    await expect(f.api.searchFees({ applicationType: row.applicationType, keyword: '  租赁  ' })).resolves.toEqual([{ value: '12', label: '车辆租赁费' }])
    expect(f.calls[1]).toEqual({ url: '/admin-api/finance/fee-purpose/get', method: 'get', params: { id: row.id } })
    expect(f.calls[2]).toEqual({ url: '/admin-api/finance/fee-purpose/application-type-options', method: 'get', params: { keyword: '车辆' } })
    expect(f.calls[3]).toEqual({ url: '/admin-api/finance/fee-purpose/fee-options', method: 'get', params: { applicationType: row.applicationType, keyword: '租赁' } })
    await expect(f.api.searchFees({ applicationType: '' })).rejects.toThrow('applicationType')
  })

  it('创建严格复刻Portal三字段载荷，并按Unicode码点校验用途', async () => {
    const f = fixture([row.id])
    const prepared = f.api.prepareCreate({ applicationType: row.applicationType, feeCode: 12, purpose: '😀😀😀' })
    expect(prepared).toEqual({ draft: { applicationType: row.applicationType, feeCode: '12', purpose: '😀😀😀' } })
    await expect(f.api.create(prepared)).resolves.toBe(row.id)
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/fee-purpose/create', method: 'post', data: prepared.draft })
    expect(() => f.api.prepareCreate({ applicationType: row.applicationType, feeCode: '12', purpose: '                ' })).toThrow('purpose')
    expect(() => f.api.prepareCreate({ applicationType: row.applicationType, feeCode: '12', purpose: '1234567890123456' })).toThrow('15个Unicode码点')
    expect(() => f.api.prepareCreate({ applicationType: row.applicationType, feeCode: '12', purpose: '😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀' })).toThrow('15个Unicode码点')
  })

  it('编辑只允许停用行的purpose，提交最小{id,purpose}载荷', async () => {
    const f = fixture([true])
    const prepared = f.api.prepareUpdate({ current: disabledRow, changes: { purpose: '新用途' } })
    expect(prepared).toEqual({ draft: { id: disabledRow.id, purpose: '新用途' }, previous: { id: disabledRow.id, purpose: disabledRow.purpose } })
    await expect(f.api.update(prepared)).resolves.toBe(true)
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/fee-purpose/update', method: 'put', data: prepared.draft })
    expect(() => f.api.prepareUpdate({ current: row, changes: { purpose: '不允许' } })).toThrow('停用')
    expect(() => f.api.prepareUpdate({ current: disabledRow, changes: { status: 0 } as never })).toThrow('不支持字段status')
  })

  it('启停使用绝对数值状态并保护重复目标；删除只允许停用行', async () => {
    const status = fixture([true])
    const prepared = status.api.prepareSetStatus({ current: row, targetStatus: 1 })
    expect(prepared).toEqual({ draft: { id: row.id, status: 1 }, previous: { id: row.id, status: 0 } })
    await expect(status.api.setStatus(prepared)).resolves.toBe(true)
    expect(status.calls[0]).toEqual({ url: '/admin-api/finance/fee-purpose/update-status', method: 'put', data: prepared.draft })
    expect(() => status.api.prepareSetStatus({ current: row, targetStatus: 0 })).toThrow('相反')

    const remove = fixture([true])
    const removeDraft = remove.api.prepareRemove({ current: disabledRow })
    expect(removeDraft).toEqual({ draft: { id: disabledRow.id } })
    await expect(remove.api.remove(removeDraft)).resolves.toBe(true)
    expect(remove.calls[0]).toEqual({ url: '/admin-api/finance/fee-purpose/delete', method: 'delete', params: { id: disabledRow.id } })
    expect(() => remove.api.prepareRemove({ current: row })).toThrow('停用')
  })

  it('坏响应、非法回执和AI契约反证必须失败', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ ...row, status: 2 }]).api.get({ id: row.id })).rejects.toThrow('status')
    await expect(fixture([[{ value: '', label: 'bad' }]]).api.searchApplicationTypes()).rejects.toThrow('value')
    await expect(fixture([false]).api.update({ draft: { id: disabledRow.id, purpose: 'x' } })).rejects.toThrow('不是true')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: financeSettingFeePurposeCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_FEE_PURPOSE_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_FEE_PURPOSE_METHODS).map(method => `financeSettingFeePurpose.${method}`))
    const broken = structuredClone(contracts)
    const brokenField = broken['finance-setting-fee-purpose-create']!.output.fields.find(field => field.path === '$')!
    brokenField.path = 'not a valid path'
    expect(validateAiContracts(broken, { definitions: financeSettingFeePurposeCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
