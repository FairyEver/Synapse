import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  calculateFinanceSettingLivestockAmortizationCoefficient,
  createFinanceSettingLivestockAmortizationCapability,
  financeSettingLivestockAmortizationCapabilities,
  FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHODS,
  FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PAGE_PATH,
  type FinanceSettingLivestockAmortizationRow,
} from '../src/capabilities/finance-setting-livestock-amortization.js'
import {
  FINANCE_SETTING_LIVESTOCK_AMORTIZATION_AI_CONTRACTS as contracts,
  FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-livestock-amortization.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceSettingLivestockAmortizationRow = {
  id: '9007199254740993',
  generation: '1',
  breed: '罗曼粉',
  line: 'AA',
  depreciationMethod: 1,
  accrualAgeDays: 154,
  accrualAgeCoefficient: '0.0026',
  accrualMaxDays: 365,
  netSalvageRate: '0.05',
  accrualRatio: '0.8',
  status: 1,
  flockStatus: 1,
  createTime: '2026-09-24 10:00:00',
  updateTime: '2026-09-24 10:10:00',
  tenantName: '测试租户',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingLivestockAmortizationCapability(request), calls }
}

describe('财务设置→种畜摊销设置页面能力', () => {
  it('逐页静态核对菜单、路由、按钮权限、端点、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/livestock-amortization.vue'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/livestock-amortization/list.vue'), 'utf8')
    const form = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/livestock-amortization/[mode]/[id].vue'), 'utf8')
    const javaDir = join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/biologicalassetdepreciationconfig')
    const controller = readFileSync(join(javaDir, 'BiologicalAssetDepreciationConfigController.java'), 'utf8')
    const saveReq = readFileSync(join(javaDir, 'vo/BiologicalAssetDepreciationConfigSaveReqVO.java'), 'utf8')
    const pageReq = readFileSync(join(javaDir, 'vo/BiologicalAssetDepreciationConfigPageReqVO.java'), 'utf8')
    const response = readFileSync(join(javaDir, 'vo/BiologicalAssetDepreciationConfigRespVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/biologicalassetdepreciationconfig/BiologicalAssetDepreciationConfigServiceImpl.java'), 'utf8')

    expect(menu).toContain(`path: '${FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/finance/setting/livestock-amortization'")
    expect(route).toContain('permission: /dashboard/finance/setting/livestock-amortization')
    expect(list).toContain('styleV2: true')
    expect(list).toContain('customLoad: async (form)')
    expect(list).toContain("http.post('/admin-api/finance/biological-asset-depreciation-config/page', form)")
    expect(list).toContain('getDataListIsPage: true')
    for (const field of ['status: 1', 'generations: []', 'breeds: []', 'lines: []']) expect(list).toContain(field)
    for (const column of ['generation', 'breed', 'line', 'flockStatus', 'depreciationMethod', 'accrualAgeDays', 'accrualAgeCoefficient', 'accrualMaxDays', 'netSalvageRate', 'updateTime']) expect(list).toContain(`dataIndex: '${column}'`)
    for (const permission of ['finance:setting:livestock-amortization:create', 'finance:setting:livestock-amortization:status']) expect(list).toContain(permission)
    expect(list).not.toContain('actionEdit')
    expect(list).not.toContain('export-excel')
    expect(list).toContain("http.put('/admin-api/finance/biological-asset-depreciation-config/update-status'")

    expect(form).toContain("http(`/admin-api/finance/biological-asset-depreciation-config/get?id=${id}`)")
    expect(form).toContain("http.post('/admin-api/finance/biological-asset-depreciation-config/create'")
    for (const field of ['generation: null', 'breed: null', "depreciationMethod: '1'", 'accrualAgeDays: null', 'accrualAgeCoefficient: null', 'accrualMaxDays: null', 'netSalvageRate: null', 'flockStatus: null']) expect(form).toContain(field)
    for (const field of ['generation:', 'breed:', 'accrualAgeDays:', 'accrualAgeCoefficient:', 'accrualMaxDays:', 'netSalvageRate:']) expect(form).toContain(`${field}`)
    for (const field of ['accrualAgeDays: form.accrualAgeDays ? +form.accrualAgeDays : null', 'accrualAgeCoefficient: form.accrualAgeCoefficient ? +form.accrualAgeCoefficient : null', 'accrualMaxDays: form.accrualMaxDays ? +form.accrualMaxDays : null', 'netSalvageRate: form.netSalvageRate ? +form.netSalvageRate : null']) expect(form).toContain(field)
    expect(form).toContain('value > 1')
    expect(form).toContain('(1 - Number(netSalvageRate)) / Number(accrualMaxDays)')
    expect(form).not.toContain("http.put('/admin-api/finance/biological-asset-depreciation-config/update'")

    expect(controller).toContain('@RequestMapping("/finance/biological-asset-depreciation-config")')
    for (const endpoint of ['@PostMapping("/create")', '@PutMapping("/update")', '@GetMapping("/get")', '@PostMapping("/page")', '@GetMapping("/export-excel")', '@PutMapping("/update-status")']) expect(controller).toContain(endpoint)
    expect(controller).toContain('@RequestParam("id") Long id')
    expect(controller).toContain('@RequestParam("status") Integer status')
    for (const field of ['generation', 'breed', 'line', 'depreciationMethod', 'accrualAgeDays', 'accrualAgeCoefficient', 'accrualMaxDays', 'netSalvageRate', 'accrualRatio', 'flockStatus']) expect(saveReq).toContain(`private ${field === 'generation' || field === 'breed' || field === 'line' ? 'String' : field.includes('Days') || field === 'depreciationMethod' || field === 'flockStatus' ? 'Integer' : 'BigDecimal'} ${field}`)
    for (const field of ['status', 'flockStatus', 'generations', 'breeds', 'lines']) expect(pageReq).toContain(field)
    for (const field of ['id', 'generation', 'breed', 'line', 'depreciationMethod', 'accrualAgeDays', 'accrualAgeCoefficient', 'accrualMaxDays', 'netSalvageRate', 'accrualRatio', 'status', 'flockStatus', 'createTime', 'updateTime', 'tenantName']) expect(response).toContain(field)
    expect(saveReq).toContain('@NotBlank(message = "代次不能为空")')
    expect(saveReq).toContain('@NotBlank(message = "品种不能为空")')
    expect(service).toContain('.status(1)')
    expect(service).toContain('BIOLOGICAL_ASSET_DEPRECIATION_CONFIG_EXISTS')
    expect(service).toContain('updateBiologicalAssetDepreciationConfigStatus')

    expect(financeSettingLivestockAmortizationCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHODS))
    expect(financeSettingLivestockAmortizationCapabilities.every(item => item.pagePath === FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PAGE_PATH && item.permission === '/dashboard/finance/setting/livestock-amortization' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingLivestockAmortizationCapabilities.find(item => item.id === 'finance-setting-livestock-amortization-create')?.write).toBe(true)
    expect(financeSettingLivestockAmortizationCapabilities.find(item => item.id === 'finance-setting-livestock-amortization-set-status')?.write).toBe(true)
    expect(financeSettingLivestockAmortizationCapabilities.find(item => item.id === 'finance-setting-livestock-amortization-list')?.write).toBe(false)
  })

  it('默认列表请求逐字段复刻Portal的POST表单和分页默认值', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/biological-asset-depreciation-config/page',
      method: 'post',
      data: { order: '', orderField: '', status: 1, generations: [], breeds: [], lines: [], pageNo: 1, pageSize: 20 },
    })

    const filtered = fixture([{ list: [], total: 0 }])
    await expect(filtered.api.list({ status: 0, generations: ['1', '2'], breeds: ['罗曼粉'], lines: ['AA'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(filtered.calls[0]?.data).toEqual({ order: '', orderField: '', status: 0, generations: ['1', '2'], breeds: ['罗曼粉'], lines: ['AA'], pageNo: 2, pageSize: 50 })
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
  })

  it('详情、创建载荷和Portal数字转换规则逐字段可执行', async () => {
    const f = fixture([row, row.id])
    await expect(f.api.get({ id: row.id })).resolves.toEqual(row)
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/biological-asset-depreciation-config/get', method: 'get', params: { id: row.id } })

    const prepared = f.api.prepareCreate({
      id: row.id,
      generation: '1',
      breed: '罗曼粉',
      line: 'AA',
      depreciationMethod: '1',
      accrualAgeDays: '154',
      accrualAgeCoefficient: '0.0026',
      accrualMaxDays: '365',
      netSalvageRate: '0.05',
      accrualRatio: '0.8',
      flockStatus: 1,
    })
    expect(prepared).toEqual({ draft: { id: row.id, generation: '1', breed: '罗曼粉', line: 'AA', depreciationMethod: '1', accrualAgeDays: 154, accrualAgeCoefficient: 0.0026, accrualMaxDays: 365, netSalvageRate: 0.05, flockStatus: 1, accrualRatio: '0.8' } })
    await expect(f.api.create(prepared)).resolves.toBe(row.id)
    expect(f.calls[1]).toEqual({ url: '/admin-api/finance/biological-asset-depreciation-config/create', method: 'post', data: prepared.draft })

    const zero = f.api.prepareCreate({ generation: '1', breed: '罗曼粉', accrualAgeDays: '0', accrualAgeCoefficient: '0', accrualMaxDays: '0', netSalvageRate: '0' })
    expect(zero.draft).toMatchObject({ accrualAgeDays: 0, accrualAgeCoefficient: 0, accrualMaxDays: 0, netSalvageRate: 0, depreciationMethod: '1', line: null, flockStatus: null })
    expect(() => f.api.prepareCreate({ generation: '1', breed: '罗曼粉', accrualAgeDays: 0, accrualAgeCoefficient: 0, accrualMaxDays: 0, netSalvageRate: 0 })).not.toThrow()
    expect(() => f.api.prepareCreate({ generation: '', breed: '罗曼粉', accrualAgeDays: '1', accrualAgeCoefficient: '0.1', accrualMaxDays: '1', netSalvageRate: '0' })).toThrow('generation')
    expect(() => f.api.prepareCreate({ generation: '1', breed: '罗曼粉', accrualAgeDays: '1.5', accrualAgeCoefficient: '0.1', accrualMaxDays: '1', netSalvageRate: '0' })).toThrow('整数')
    expect(() => f.api.prepareCreate({ generation: '1', breed: '罗曼粉', accrualAgeDays: '1', accrualAgeCoefficient: '0.1', accrualMaxDays: '1', netSalvageRate: '1.1' })).toThrow('不能大于1')
    expect(() => f.api.prepareCreate({ generation: '1'.repeat(101), breed: '罗曼粉', accrualAgeDays: '1', accrualAgeCoefficient: '0.1', accrualMaxDays: '1', netSalvageRate: '0' })).toThrow('100')
  })

  it('启停请求复刻Portal的绝对状态和PUT body.params形状，本地公式与页面一致', async () => {
    const f = fixture([true])
    const prepared = f.api.prepareSetStatus({ current: row, targetStatus: 0 })
    expect(prepared).toEqual({ draft: { id: row.id, status: 0 }, previous: { id: row.id, status: 1 } })
    await expect(f.api.setStatus(prepared)).resolves.toBe(true)
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/biological-asset-depreciation-config/update-status', method: 'put', data: { params: { id: row.id, status: 0 } } })
    expect(() => f.api.prepareSetStatus({ current: row, targetStatus: 1 })).toThrow('相反')
    expect(calculateFinanceSettingLivestockAmortizationCoefficient({ netSalvageRate: '0.05', accrualMaxDays: '365' })).toBeCloseTo(0.0026027397)
    expect(f.api.calculateAccrualAgeCoefficient({ netSalvageRate: '1', accrualMaxDays: 365 })).toBeNull()
    expect(f.api.calculateAccrualAgeCoefficient({ netSalvageRate: null, accrualMaxDays: 365 })).toBeNull()
  })

  it('坏响应、权限边界和AI契约反证必须失败', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, status: 2 }], total: 1 }]).api.list()).rejects.toThrow('status')
    await expect(fixture([null]).api.get({ id: row.id })).resolves.toBeNull()
    await expect(fixture([false]).api.setStatus({ draft: { id: row.id, status: 0 } })).rejects.toThrow('不是true')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: financeSettingLivestockAmortizationCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHODS).map(method => `financeSettingLivestockAmortization.${method}`))
    const broken = structuredClone(contracts)
    const brokenField = broken['finance-setting-livestock-amortization-create']!.output.fields.find(field => field.path === '$')!
    brokenField.path = 'not a valid path'
    expect(validateAiContracts(broken, { definitions: financeSettingLivestockAmortizationCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
