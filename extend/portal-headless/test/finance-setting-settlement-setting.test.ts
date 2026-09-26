import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingSettlementSettingCapability,
  financeSettingSettlementSettingCapabilities,
  FINANCE_SETTING_SETTLEMENT_SETTING_METHODS,
  FINANCE_SETTING_SETTLEMENT_SETTING_PAGE_PATH,
  type FinanceSettlementSettingRow,
} from '../src/capabilities/finance-setting-settlement-setting.js'
import {
  FINANCE_SETTING_SETTLEMENT_SETTING_AI_CONTRACTS as contracts,
  FINANCE_SETTING_SETTLEMENT_SETTING_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-settlement-setting.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceSettlementSettingRow = {
  id: '9007199254740993', accountingEntityType: 'corporation', accountingScopeOrgIds: ['11', '12'],
  externalSalesBelongType: 'sales_org', validType: 'range', effectiveStart: '2026-01', effectiveEnd: '2026-12',
  status: 1, creatorName: '张三', createTime: '2026-09-23 09:00:00',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingSettlementSettingCapability(request), calls }
}

describe('财务设置→结转单设置页面能力', () => {
  it('静态锁定菜单、权限、表单规则、组织树和Java端点', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/settlement-setting.vue'), 'utf8')
    const list = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/settlement-setting/list.vue'), 'utf8')
    const form = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/settlement-setting/[mode]/[id].vue'), 'utf8')
    const tree = readFileSync(join(root, 'app/portal/components/portal/finance/tree-select/post-tree/index.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/settlement/SettlementSettingController.java'), 'utf8')
    const save = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/settlement/vo/SettlementSettingSaveReqVO.java'), 'utf8')

    expect(menu).toContain("path: '" + FINANCE_SETTING_SETTLEMENT_SETTING_PAGE_PATH + "'")
    expect(menu).toContain("permission: '/dashboard/finance/setting/settlement-setting'")
    expect(route).toContain('permission: /dashboard/finance/setting/settlement-setting')
    expect(list).toContain("getDataListURL: '/admin-api/finance/settlement-setting/page'")
    expect(list).toContain("status: 'finance:setting:settlement-setting:status'")
    expect(list).toContain("http.put('/admin-api/finance/settlement-setting/update-status', { params:")
    expect(form).toContain("http.get('/admin-api/finance/settlement-setting/get'")
    expect(form).toContain("http.post('/admin-api/finance/settlement-setting/create'")
    expect(form).toContain("http.put('/admin-api/finance/settlement-setting/update'")
    expect(tree).toContain("/admin-api/org/organization/getRoleOrganizationTreeNew")
    expect(controller).toContain('@ConditionalOnProperty')
    expect(controller).toContain('@RequestMapping("/finance/settlement-setting")')
    expect(controller).toContain('@RequestParam("status") Integer status')
    expect(save).toContain('private List<Long> accountingScopeOrgIds')
    expect(financeSettingSettlementSettingCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_SETTLEMENT_SETTING_METHODS))
    expect(financeSettingSettlementSettingCapabilities.every(item => item.permission === '/dashboard/finance/setting/settlement-setting' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
  })

  it('默认列表复现筛选和分页参数，并投影页面字段', async () => {
    const f = fixture([{ list: [{ ...row, ignored: 'x' }], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/settlement-setting/page', method: 'get',
      params: { order: '', orderField: '', accountingEntityType: undefined, status: 1, pageNo: 1, pageSize: 20 },
    })
  })

  it('列表筛选和分页非法时不发请求', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await expect(f.api.list({ accountingEntityType: 'corporation', status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls[0]?.params).toEqual({ order: '', orderField: '', accountingEntityType: 'corporation', status: 0, pageNo: 2, pageSize: 50 })
    await expect(f.api.list({ status: 2 as 0 })).rejects.toThrow('status')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    expect(f.calls).toHaveLength(1)
  })

  it('详情和组织树复现Portal支撑读取', async () => {
    const tree = [{ id: 1, name: '总部', pid: null, children: [{ id: '2', name: '法人', pid: 1, isCorporation: 1, children: [] }] }]
    const f = fixture([row, tree])
    await expect(f.api.get({ id: row.id })).resolves.toEqual(row)
    await expect(f.api.organizationTree()).resolves.toEqual(tree)
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/settlement-setting/get', method: 'get', params: { id: row.id } },
      { url: '/admin-api/org/organization/getRoleOrganizationTreeNew', method: 'get', params: { excludePost: false } },
    ])
  })

  it('创建严格复现表单字段、默认id和长期有效空结束月', async () => {
    const f = fixture(['9007199254740997'])
    const input = { accountingEntityType: 'corporation' as const, accountingScopeOrgIds: ['11', 12], externalSalesBelongType: 'sales_org' as const, validType: 'range' as const, effectiveStart: '2026-01', effectiveEnd: '2026-12', status: 1 as const }
    expect(f.api.prepareCreate(input).draft).toEqual({ id: '', ...input })
    await expect(f.api.create(input)).resolves.toBe('9007199254740997')
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/settlement-setting/create', method: 'post', data: { id: '', ...input } })

    const longTerm = fixture([])
    expect(longTerm.api.prepareCreate({ ...input, validType: 'long_term', effectiveEnd: '2026-12' }).draft.effectiveEnd).toBe('')
    expect(() => f.api.prepareCreate({ ...input, accountingScopeOrgIds: [] })).toThrow('非空')
    expect(() => f.api.prepareCreate({ ...input, effectiveEnd: '2025-12' })).toThrow('不能早于')
    expect(() => f.api.prepareCreate({ ...input, effectiveStart: '2026-13' })).toThrow('YYYY-MM')
  })

  it('更新保留完整表单快照，状态启停复现Portal实际PUT body并可用previous补偿', async () => {
    const f = fixture([true, true, true])
    const prepared = f.api.prepareUpdate({ current: row, changes: { effectiveEnd: '2027-01' } })
    expect(prepared.draft).toMatchObject({ id: row.id, effectiveEnd: '2027-01' })
    await expect(f.api.update({ current: row, changes: { effectiveEnd: '2027-01' } })).resolves.toBe(true)
    const status = f.api.prepareSetStatus({ current: row, targetStatus: 0 })
    await expect(f.api.setStatus({ draft: status.draft })).resolves.toBe(true)
    await expect(f.api.setStatus({ draft: status.previous })).resolves.toBe(true)
    expect(f.calls).toContainEqual({
      url: '/admin-api/finance/settlement-setting/update', method: 'put',
      data: {
        id: row.id, accountingEntityType: row.accountingEntityType, accountingScopeOrgIds: row.accountingScopeOrgIds,
        externalSalesBelongType: row.externalSalesBelongType, validType: row.validType, effectiveStart: row.effectiveStart,
        effectiveEnd: '2027-01', status: row.status,
      },
    })
    expect(f.calls).toContainEqual({ url: '/admin-api/finance/settlement-setting/update-status', method: 'put', data: { params: { id: row.id, status: 0 } } })
    expect(f.calls).toContainEqual({ url: '/admin-api/finance/settlement-setting/update-status', method: 'put', data: { params: { id: row.id, status: 1 } } })
    expect(() => f.api.prepareSetStatus({ current: row, targetStatus: 1 })).toThrow('相反')
  })

  it('坏响应、坏组织树和非true写回执不会静默成功', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ ...row, id: 0 }]).api.get({ id: 1 })).rejects.toThrow('id')
    await expect(fixture([[{ id: 1, name: 'x', children: [{ id: 0, name: 'bad' }] }]]).api.organizationTree()).rejects.toThrow('id')
    await expect(fixture([false]).api.update({ current: row })).rejects.toThrow('不是true')
  })

  it('AI契约登记、关键映射和反证字段存在', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_SETTLEMENT_SETTING_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_SETTLEMENT_SETTING_METHODS).map(method => `financeSettingSettlementSetting.${method}`))
    expect(contracts['finance-setting-settlement-setting-list']?.output.fields.some(field => field.path === 'list[].accountingScopeOrgIds')).toBe(true)
    expect(contracts['finance-setting-settlement-setting-prepare-create']?.steps.some(step => step.mapping?.accountingScopeOrgIds === 'result.draft.accountingScopeOrgIds')).toBe(true)
    expect(contracts['finance-setting-settlement-setting-set-status']?.boundaries.join('\n')).toContain('实际')
  })
})
