import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingCostCenterCapability,
  financeSettingCostCenterCapabilities,
  FINANCE_SETTING_COST_CENTER_METHODS,
  FINANCE_SETTING_COST_CENTER_PAGE_PATH,
  type FinanceSettingCostCenterRow,
} from '../src/capabilities/finance-setting-cost-center.js'
import {
  FINANCE_SETTING_COST_CENTER_AI_CONTRACTS as contracts,
  FINANCE_SETTING_COST_CENTER_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-cost-center.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceSettingCostCenterRow = {
  id: '9007199254740993',
  name: '生产成本中心',
  code: 'CC-100',
  unitId: '1001',
  unitName: '生产单元',
  companyId: null,
  companyName: null,
  companyOrgName: null,
  legalPersonId: '3001',
  legalPersonName: '北京沃德博创有限公司',
  accountingSetId: '4001',
  accountingSetName: '北京公司账套',
  status: 1,
  orgList: [{ orgId: '2001', orgName: '一场', fullPath: '北京 / 一场' }],
  updateTime: '2026-09-23 10:00:00',
  orgAttribute: 1,
  subjectCodePrefix: '5001',
  editable: true,
  deletable: true,
  disableReason: null,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingCostCenterCapability(request), calls }
}

describe('财务设置→成本中心管理页面能力', () => {
  it('逐页静态核对菜单、路由、按钮权限、端点和Java后端字段', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/cost-center.vue'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/cost-center/list.vue'), 'utf8')
    const form = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/cost-center/[mode]/[id].vue'), 'utf8')
    const javaDir = join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/costcenter')
    const controller = readFileSync(join(javaDir, 'CostCenterController.java'), 'utf8')
    const pageReq = readFileSync(join(javaDir, 'vo/CostCenterPageReqVO.java'), 'utf8')
    const saveReq = readFileSync(join(javaDir, 'vo/CostCenterSaveReqVO.java'), 'utf8')
    const response = readFileSync(join(javaDir, 'vo/CostCenterRespVO.java'), 'utf8')
    const scopeResponse = readFileSync(join(javaDir, 'vo/CostCenterOrgScopeRespVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/costcenter/CostCenterServiceImpl.java'), 'utf8')

    expect(menu).toContain(`path: '${FINANCE_SETTING_COST_CENTER_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/finance/setting/cost-center'")
    expect(route).toContain('permission: /dashboard/finance/setting/cost-center')
    expect(list).toContain("http.post('/admin-api/finance/cost-center/page', params)")
    expect(list).toContain("create: 'finance:setting:cost-center:create'")
    expect(list).toContain("edit: 'finance:setting:cost-center:edit'")
    expect(list).toContain("status: 'finance:setting:cost-center:status'")
    expect(list).toContain("http.put('/admin-api/finance/cost-center/update-status'")
    expect(form).toContain("http.get('/admin-api/finance/cost-center/get'")
    expect(form).toContain("http.post('/admin-api/finance/cost-center/create'")
    expect(form).toContain("http.put('/admin-api/finance/cost-center/update'")
    expect(form).toContain('delete restForm.accountingSetName')
    expect(form).toContain("http.get('/admin-api/finance/cost-center/resolve-org-scope'")
    expect(form).toContain("http.get('/admin-api/finance/cost-center/generate-code'")
    expect(form).toContain("name: [\n      { required: true")
    expect(form).toContain("unitId: [\n      { required: true")
    expect(form).toContain("orgAttribute: [\n      { required: true")
    expect(controller).toContain('@RequestMapping("/finance/cost-center")')
    expect(controller).toContain('@PostMapping("/create")')
    expect(controller).toContain('@PutMapping("/update")')
    expect(controller).toContain('@PutMapping("/update-status")')
    expect(controller).toContain('@GetMapping("/get")')
    expect(controller).toContain('@PostMapping("/page")')
    expect(controller).toContain('@GetMapping("/generate-code")')
    expect(controller).toContain('@GetMapping("/resolve-org-scope")')
    expect(pageReq).toContain('private String name')
    expect(pageReq).toContain('private Long accountingSetId')
    expect(pageReq).toContain('private Long orgId')
    expect(pageReq).toContain('private Integer status')
    expect(pageReq).toContain('private Integer orgAttribute')
    expect(saveReq).toContain('private Long unitId')
    expect(saveReq).toContain('private List<Long> orgIds')
    expect(saveReq).toContain('private Integer status')
    expect(response).toContain('List<CostCenterOrgRespVO> orgList')
    expect(response).toContain('private Boolean editable')
    expect(scopeResponse).toContain('private Long accountingSetId')
    expect(service).toContain('getCostCenterPage')
    expect(service).toContain('resolveOrgScope')
    expect(service).toContain('generateCode')
    expect(financeSettingCostCenterCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_COST_CENTER_METHODS))
    expect(financeSettingCostCenterCapabilities.every(item => item.permission === '/dashboard/finance/setting/cost-center' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingCostCenterCapabilities.find(item => item.id === 'finance-setting-cost-center-create')?.write).toBe(true)
    expect(financeSettingCostCenterCapabilities.find(item => item.id === 'finance-setting-cost-center-set-status')?.write).toBe(true)
  })

  it('默认列表严格复现页面表单、数值状态、分页和可见筛选键', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/cost-center/page',
      method: 'post',
      data: {
        order: '',
        orderField: '',
        name: null,
        code: null,
        unitName: null,
        accountingSetId: null,
        orgId: null,
        orgAttribute: null,
        status: 1,
        pageNo: 1,
        pageSize: 20,
      },
    })
    const filtered = fixture([{ list: [], total: 0 }])
    await expect(filtered.api.list({ name: '生产', code: 'CC', unitName: '单元', accountingSetId: '4001', orgId: '2001', orgAttribute: 1, status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(filtered.calls[0]?.data).toEqual({
      order: '', orderField: '', name: '生产', code: 'CC', unitName: '单元', accountingSetId: '4001', orgId: '2001', orgAttribute: 1, status: 0, pageNo: 2, pageSize: 50,
    })
  })

  it('详情、组织范围解析和编码预填逐个对应Portal端点', async () => {
    const f = fixture([row, { orgId: '2001', orgName: '一场', accountingSetId: '4001', accountingSetName: '北京公司账套', companyId: null, companyOrgName: null, legalPersonId: '3001', legalPersonName: '北京沃德博创有限公司', companyName: null }, 'CC-101'])
    await expect(f.api.get({ id: row.id })).resolves.toEqual(row)
    await expect(f.api.resolveOrgScope({ orgId: '2001' })).resolves.toEqual({ orgId: '2001', orgName: '一场', accountingSetId: '4001', accountingSetName: '北京公司账套', companyId: null, companyOrgName: null, legalPersonId: '3001', legalPersonName: '北京沃德博创有限公司', companyName: null })
    await expect(f.api.generateCode({ unitId: '1001' })).resolves.toBe('CC-101')
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/cost-center/get', method: 'get', params: { id: row.id } },
      { url: '/admin-api/finance/cost-center/resolve-org-scope', method: 'get', params: { orgId: '2001' } },
      { url: '/admin-api/finance/cost-center/generate-code', method: 'get', params: { unitId: '1001' } },
    ])
  })

  it('新建严格保留表单提交字段、空组织规则和不提交accountingSetName', async () => {
    const input = { name: '新成本中心', unitId: '1001', orgAttribute: 2 as const, orgIds: ['node_2001', '9007199254740995'], code: 'CC-NEW', accountingSetId: '4001' }
    const prepared = fixture()
    expect(prepared.api.prepareCreate(input)).toEqual({ draft: {
      id: '', name: '新成本中心', unitId: '1001', code: 'CC-NEW', orgAttribute: 2, orgIds: ['2001', '9007199254740995'], accountingSetId: '4001', status: 1,
    } })
    const f = fixture(['9007199254740997'])
    await expect(f.api.create({ draft: f.api.prepareCreate(input).draft })).resolves.toBe('9007199254740997')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/cost-center/create',
      method: 'post',
      data: { id: '', name: '新成本中心', unitId: '1001', code: 'CC-NEW', orgAttribute: 2, orgIds: ['2001', '9007199254740995'], accountingSetId: '4001', status: 1 },
    })
    const empty = fixture()
    expect(empty.api.prepareCreate({ name: '虚拟成本中心', unitId: '1001', orgAttribute: 1 })).toMatchObject({ draft: { orgIds: [], status: 1 } })
  })

  it('编辑只允许页面可编辑字段，保留完整提交体和previous；启停发送绝对数值状态', async () => {
    const f = fixture([true, true])
    const prepared = f.api.prepareUpdate({ current: row, changes: { name: '编辑后的成本中心', orgAttribute: 3 } })
    expect(prepared.draft).toEqual({ id: row.id, name: '编辑后的成本中心', unitId: row.unitId, code: row.code, orgAttribute: 3, orgIds: ['2001'], accountingSetId: row.accountingSetId, status: 1 })
    expect(prepared.previous).toEqual({ id: row.id, name: row.name, unitId: row.unitId, code: row.code, orgAttribute: 1, orgIds: ['2001'], accountingSetId: row.accountingSetId, status: 1 })
    await expect(f.api.update({ draft: prepared.draft })).resolves.toBe(true)
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/cost-center/update', method: 'put', data: prepared.draft })
    const preparedStatus = f.api.prepareSetStatus({ current: row, targetStatus: 0 })
    expect(preparedStatus).toEqual({ draft: { id: row.id, status: 0 }, previous: { id: row.id, status: 1 } })
    await expect(f.api.setStatus({ draft: preparedStatus.draft })).resolves.toBe(true)
    expect(f.calls[1]).toEqual({ url: '/admin-api/finance/cost-center/update-status', method: 'put', data: { id: row.id, status: 0 } })
    expect(() => f.api.prepareSetStatus({ current: row, targetStatus: 1 })).toThrow('相反')
    expect(() => f.api.prepareUpdate({ current: row, changes: { unitId: '2' } as never })).toThrow('不支持')
  })

  it('逐条锁定Portal校验、后端范围和坏响应反证', async () => {
    const f = fixture()
    expect(() => f.api.prepareCreate({ name: '', unitId: '1001', orgAttribute: 1 })).toThrow('name')
    expect(() => f.api.prepareCreate({ name: '名称', unitId: 'bad', orgAttribute: 1 })).toThrow('unitId')
    expect(() => f.api.prepareCreate({ name: '名称', unitId: '1001', orgAttribute: 7 as never })).toThrow('orgAttribute')
    expect(() => f.api.prepareCreate({ name: 'x'.repeat(501), unitId: '1001', orgAttribute: 1 })).toThrow('500')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, status: true }], total: 1 }]).api.list()).rejects.toThrow('status')
    await expect(fixture([false]).api.setStatus({ draft: { id: row.id, status: 0 } })).rejects.toThrow('不是true')
  })

  it('AI契约逐方法登记、描述返回和关键字段映射存在；破坏映射时断言失败', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: financeSettingCostCenterCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_COST_CENTER_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_COST_CENTER_METHODS).map(method => `financeSettingCostCenter.${method}`))
    expect(contracts['finance-setting-cost-center-list']?.output.fields.some(field => field.path === 'list[].status')).toBe(true)
    expect(contracts['finance-setting-cost-center-prepare-create']?.steps.some(step => step.mapping?.draft === 'result.draft')).toBe(true)
    expect(contracts['finance-setting-cost-center-create']?.output.fields.some(field => field.path === '$')).toBe(true)
    expect(contracts['finance-setting-cost-center-update']?.steps.some(step => step.mapping?.id === 'context.draft.id')).toBe(true)
    expect(contracts['finance-setting-cost-center-set-status']?.steps.some(step => step.mapping?.draft === 'context.previous')).toBe(true)
    const broken = structuredClone(contracts)
    broken['finance-setting-cost-center-create']!.output.fields = broken['finance-setting-cost-center-create']!.output.fields.filter(field => field.path !== '$')
    expect(validateAiContracts(broken, { definitions: financeSettingCostCenterCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
