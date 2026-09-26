import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingAllocationRulesCapability,
  financeSettingAllocationRulesCapabilities,
  FINANCE_ALLOCATION_RULE_TYPE,
  FINANCE_SETTING_ALLOCATION_RULES_METHODS,
  FINANCE_SETTING_ALLOCATION_RULES_PAGE_PATH,
  type FinanceAllocationRuleRow,
} from '../src/capabilities/finance-setting-allocation-rules.js'
import {
  FINANCE_SETTING_ALLOCATION_RULES_AI_CONTRACTS as contracts,
  FINANCE_SETTING_ALLOCATION_RULES_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-allocation-rules.js'

type RequestConfig = Parameters<PortalRequest>[0]

const allocator = {
  id: '100',
  code: 'CC-100',
  name: '生产成本中心',
  unitId: '10',
  orgAttribute: 1,
  orgIds: ['200'],
}

const receiver = {
  id: '101',
  code: 'CC-101',
  name: '接收成本中心',
  unitId: '10',
  orgAttribute: 2,
  orgIds: ['201'],
}

const row: FinanceAllocationRuleRow = {
  id: '9007199254740993',
  status: true,
  createTime: '2026-09-23 10:00:00',
  updateTime: '2026-09-23 10:00:00',
  allocateOrg: null,
  ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS,
  orderAllocationType: null,
  expenseType: '29',
  expenseTypeName: '空舍费',
  indicator: '8001',
  acceptOrg: null,
  description: '按生产成本中心分摊空舍费',
  orgFullPath: null,
  unitId: '10',
  unitName: '财务单元',
  unitType: '1',
  orgAttribute: null,
  ruleOrder: 1,
  productGroups: '',
  productGroupsName: null,
  revenueSubjectIds: null,
  revenueSubjectNames: null,
  allocateTargets: null,
  acceptTargets: null,
  allocateCostCenters: [allocator],
  acceptCostCenters: [receiver],
  costCenterMigrationStatus: null,
  costCenterMigrationMessage: null,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingAllocationRulesCapability(request), calls }
}

describe('财务设置→费用分配规则页面能力', () => {
  it('逐页静态核对菜单、路由、按钮权限、端点和Java后端规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/allocation-rules.vue'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/allocation-rules/list.vue'), 'utf8')
    const form = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/allocation-rules/[mode]/[id].vue'), 'utf8')
    const detail = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/allocation-rules/detail/[id].vue'), 'utf8')
    const javaDir = join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/expenseallocationrule')
    const controller = readFileSync(join(javaDir, 'ExpenseAllocationRuleController.java'), 'utf8')
    const pageReq = readFileSync(join(javaDir, 'vo/ExpenseAllocationRulePageReqVO.java'), 'utf8')
    const saveReq = readFileSync(join(javaDir, 'vo/ExpenseAllocationRuleSaveReqVO.java'), 'utf8')
    const statusReq = readFileSync(join(javaDir, 'vo/ExpenseAllocationRuleStatusReqVO.java'), 'utf8')
    const response = readFileSync(join(javaDir, 'vo/ExpenseAllocationRuleRespVO.java'), 'utf8')
    const validator = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/expenseallocationrule/ExpenseAllocationRuleCostCenterValidator.java'), 'utf8')

    expect(menu).toContain(`path: '${FINANCE_SETTING_ALLOCATION_RULES_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/finance/setting/allocation-rules'")
    expect(route).toContain('permission: /dashboard/finance/setting/allocation-rules')
    expect(list).toContain("http.post('/admin-api/finance/expense-allocation-rule/page', params)")
    expect(list).toContain("create: 'finance:setting:allocation-rules:create'")
    expect(list).toContain("status: 'finance:setting:allocation-rules:status'")
    expect(list).toContain("detail: 'finance:setting:allocation-rules:detail'")
    expect(list).toContain("http.post('/admin-api/finance/expense-allocation-rule/updateStatus'")
    expect(form).toContain("http.post('/admin-api/finance/expense-allocation-rule/create'")
    expect(form).toContain("http.put('/admin-api/finance/expense-allocation-rule/update'")
    expect(form).toContain("http.post('/admin-api/finance/expense-allocation-rule/page'")
    expect(form).toContain('validateSaveBusinessRules(payload)')
    expect(form).toContain('validateCostCenterOverlap(payload)')
    expect(form).toContain("finance:setting:allocation-rules:create")
    expect(detail).toContain('/admin-api/finance/expense-allocation-rule/get?id=')
    expect(controller).toContain('@RequestMapping("/finance/expense-allocation-rule")')
    expect(controller).toContain('@PostMapping("/create")')
    expect(controller).toContain('@PutMapping("/update")')
    expect(controller).toContain('@PostMapping("/updateStatus")')
    expect(pageReq).toContain('List<Long> allocateCostCenterIdList')
    expect(pageReq).toContain('List<Long> acceptCostCenterIdList')
    expect(saveReq).toContain('List<Long> allocateCostCenterIds')
    expect(saveReq).toContain('List<Long> acceptCostCenterIds')
    expect(statusReq).toContain('Boolean status')
    expect(response).toContain('List<ExpenseAllocationCostCenterRespVO> allocateCostCenters')
    expect(validator).toContain('validateSaveBusinessRules')
    expect(validator).toContain('orgAttribute')
    expect(financeSettingAllocationRulesCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_ALLOCATION_RULES_METHODS))
    expect(financeSettingAllocationRulesCapabilities.every(item => item.permission === '/dashboard/finance/setting/allocation-rules' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingAllocationRulesCapabilities.find(item => item.id === 'finance-setting-allocation-rules-create')?.write).toBe(true)
    expect(financeSettingAllocationRulesCapabilities.find(item => item.id === 'finance-setting-allocation-rules-set-status')?.write).toBe(true)
  })

  it('默认列表严格复现页面表单、数值状态、分页和可见筛选键', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/expense-allocation-rule/page',
      method: 'post',
      data: {
        order: '',
        orderField: '',
        unitIdList: [],
        allocateCostCenterIdList: [],
        acceptCostCenterIdList: [],
        ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS,
        expenseTypeIdList: [],
        indicator: null,
        status: 1,
        pageNo: 1,
        pageSize: 20,
      },
    })
    const filtered = fixture([{ list: [], total: 0 }])
    await expect(filtered.api.list({ unitIdList: ['10'], allocateCostCenterIdList: ['100'], acceptCostCenterIdList: ['101'], expenseTypeIdList: ['29'], indicator: '8001', status: 0, ruleType: FINANCE_ALLOCATION_RULE_TYPE.ORDER, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(filtered.calls[0]?.data).toEqual({
      order: '', orderField: '', unitIdList: ['10'], allocateCostCenterIdList: ['100'], acceptCostCenterIdList: ['101'],
      ruleType: FINANCE_ALLOCATION_RULE_TYPE.ORDER, expenseTypeIdList: ['29'], indicator: '8001', status: 0, pageNo: 2, pageSize: 50,
    })
  })

  it('详情投影页面消费字段并保留成本中心组织财务属性快照', async () => {
    const f = fixture([row])
    await expect(f.api.get({ id: row.id })).resolves.toEqual(row)
    expect(f.calls).toEqual([{ url: '/admin-api/finance/expense-allocation-rule/get', method: 'get', params: { id: row.id } }])
  })

  it('新建同时锁定类别分摊和订单分配的提交字段、规则与Portal重复预检', async () => {
    const classInput = {
      ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS,
      allocateCostCenterIds: ['100'],
      acceptCostCenterIds: ['101'],
      expenseType: '29',
      indicator: '8001',
      ruleOrder: 2,
      description: '按生产成本中心分摊空舍费',
      allocateCostCenters: [allocator],
    }
    const preparedClass = fixture()
    expect(preparedClass.api.prepareCreate(classInput)).toEqual({ draft: {
      status: true, ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS, orderAllocationType: null, expenseType: '29', indicator: '8001', description: classInput.description,
      ruleOrder: 2, productGroups: '', allocateCostCenterIds: ['100'], acceptCostCenterIds: ['101'], allocateCostCenters: [allocator],
    } })
    const create = fixture([{ list: [], total: 0 }, '9007199254740997'])
    const classDraft = preparedClass.api.prepareCreate(classInput).draft
    await expect(create.api.create({ draft: classDraft })).resolves.toBe('9007199254740997')
    expect(create.calls).toEqual([
      { url: '/admin-api/finance/expense-allocation-rule/page', method: 'post', data: {
        pageNo: 1, pageSize: 999, ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS,
        allocateCostCenterIdList: ['100'], acceptCostCenterIdList: ['101'], orderAllocationType: null,
        indicator: '8001', expenseTypeIdList: ['29'], status: null,
      } },
      { url: '/admin-api/finance/expense-allocation-rule/create', method: 'post', data: {
        status: true, ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS, orderAllocationType: null, expenseType: '29', indicator: '8001',
        description: classInput.description, ruleOrder: 2, productGroups: '', allocateCostCenterIds: ['100'], acceptCostCenterIds: ['101'],
      } },
    ])

    const order = fixture()
    const orderDraft = order.api.prepareCreate({
      ruleType: FINANCE_ALLOCATION_RULE_TYPE.ORDER,
      allocateCostCenterIds: ['100'],
      acceptCostCenterIds: ['101'],
      orderAllocationType: '1' as unknown as 1,
      indicator: '8001',
      productGroups: ['2', '1'],
      description: '分配到生产订单',
      allocateCostCenters: [allocator],
    }).draft
    expect(orderDraft).toMatchObject({ status: true, ruleType: FINANCE_ALLOCATION_RULE_TYPE.ORDER, orderAllocationType: 1, expenseType: null, ruleOrder: null, productGroups: '2,1', acceptCostCenterIds: [] })
  })

  it('编辑沿用当前状态、字段并提供previous，启停使用绝对Boolean状态', async () => {
    const f = fixture([{ list: [], total: 0 }, true, true, true])
    const prepared = f.api.prepareUpdate({ current: row, changes: { description: '编辑后的描述', ruleOrder: 3 } })
    expect(prepared.draft).toMatchObject({ id: row.id, status: true, description: '编辑后的描述', ruleOrder: 3, allocateCostCenterIds: ['100'], acceptCostCenterIds: ['101'] })
    expect(prepared.previous).toMatchObject({ id: row.id, status: true, description: row.description, ruleOrder: 1 })
    await expect(f.api.update({ draft: prepared.draft })).resolves.toBe(true)
    expect(f.calls[0]).toMatchObject({ url: '/admin-api/finance/expense-allocation-rule/page', method: 'post' })
    expect(f.calls[1]).toEqual({ url: '/admin-api/finance/expense-allocation-rule/update', method: 'put', data: {
      id: row.id, status: true, ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS, orderAllocationType: null, expenseType: '29', indicator: '8001',
      description: '编辑后的描述', ruleOrder: 3, productGroups: '', allocateCostCenterIds: ['100'], acceptCostCenterIds: ['101'],
    } })
    const preparedStatus = f.api.prepareSetStatus({ current: row, targetStatus: false })
    expect(preparedStatus).toEqual({ draft: { id: row.id, status: false }, previous: { id: row.id, status: true } })
    await expect(f.api.setStatus({ draft: preparedStatus.draft })).resolves.toBe(true)
    expect(f.calls[2]).toEqual({ url: '/admin-api/finance/expense-allocation-rule/updateStatus', method: 'post', data: { id: row.id, status: false } })
    await expect(f.api.setStatus({ draft: preparedStatus.previous })).resolves.toBe(true)
    expect(f.calls[3]).toEqual({ url: '/admin-api/finance/expense-allocation-rule/updateStatus', method: 'post', data: { id: row.id, status: true } })
    expect(() => f.api.prepareSetStatus({ current: row, targetStatus: true })).toThrow('相反')
  })

  it('逐条锁定页面表单和后端成本中心业务规则，坏输入必须在写入前失败', async () => {
    const f = fixture()
    const base = { ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS, allocateCostCenterIds: ['100'], acceptCostCenterIds: ['101'], expenseType: '20', indicator: '8001', ruleOrder: 1, description: '规则', allocateCostCenters: [allocator] }
    expect(() => f.api.prepareCreate({ ...base, allocateCostCenterIds: [] })).toThrow('非空数组')
    expect(() => f.api.prepareCreate({ ...base, acceptCostCenterIds: [] })).toThrow('非空数组')
    expect(() => f.api.prepareCreate({ ...base, acceptCostCenterIds: ['100'] })).toThrow('不能一致')
    expect(() => f.api.prepareCreate({ ...base, expenseType: '20', allocateCostCenters: [allocator] })).toThrow('空舍费')
    expect(() => f.api.prepareCreate({ ...base, ruleOrder: 0 })).toThrow('1至10000')
    expect(() => f.api.prepareCreate({ ...base, description: '' })).toThrow('不能为空')
    expect(() => f.api.prepareCreate({ ...base, description: 'x'.repeat(501) })).toThrow('500')
    expect(() => f.api.prepareCreate({ ...base, ruleType: FINANCE_ALLOCATION_RULE_TYPE.ORDER, orderAllocationType: null, acceptCostCenterIds: [] })).toThrow('不能为空')
    expect(() => f.api.prepareCreate({ ...base, ruleType: FINANCE_ALLOCATION_RULE_TYPE.ORDER, orderAllocationType: 1, allocateCostCenters: [{ ...allocator, orgAttribute: 2 }] })).toThrow('生产成本')
    expect(() => f.api.prepareCreate({ ...base, indicator: 'bad' })).toThrow('indicator')
  })

  it('重复预检命中时不发送创建/更新，坏响应不被静默改写', async () => {
    const duplicate = { id: '8', ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS, indicator: '8001', expenseType: '29', allocateCostCenters: [allocator], acceptCostCenters: [receiver] }
    const input = { ruleType: FINANCE_ALLOCATION_RULE_TYPE.CLASS, allocateCostCenterIds: ['100'], acceptCostCenterIds: ['101'], expenseType: '29', indicator: '8001', ruleOrder: 1, description: '规则', allocateCostCenters: [allocator] }
    const f = fixture([{ list: [duplicate], total: 1 }])
    await expect(f.api.create({ draft: f.api.prepareCreate(input).draft })).rejects.toThrow('重复规则')
    expect(f.calls).toHaveLength(1)
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, status: 1 }], total: 1 }]).api.list()).rejects.toThrow('布尔')
    await expect(fixture([false]).api.setStatus({ draft: { id: row.id, status: false } })).rejects.toThrow('不是true')
  })

  it('AI契约逐方法登记、描述返回和关键字段映射存在；破坏映射时断言失败', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: financeSettingAllocationRulesCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_ALLOCATION_RULES_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_ALLOCATION_RULES_METHODS).map(method => `financeSettingAllocationRules.${method}`))
    expect(contracts['finance-setting-allocation-rules-list']?.output.fields.some(field => field.path === 'list[].status')).toBe(true)
    expect(contracts['finance-setting-allocation-rules-prepare-create']?.steps.some(step => step.mapping?.draft === 'result.draft')).toBe(true)
    expect(contracts['finance-setting-allocation-rules-create']?.output.fields.some(field => field.path === '$')).toBe(true)
    expect(contracts['finance-setting-allocation-rules-update']?.steps.some(step => step.mapping?.id === 'context.draft.id')).toBe(true)
    expect(contracts['finance-setting-allocation-rules-set-status']?.steps.some(step => step.mapping?.draft === 'context.previous')).toBe(true)
    const broken = structuredClone(contracts)
    broken['finance-setting-allocation-rules-create']!.output.fields = broken['finance-setting-allocation-rules-create']!.output.fields.filter(field => field.path !== '$')
    expect(validateAiContracts(broken, { definitions: financeSettingAllocationRulesCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
