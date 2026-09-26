import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createPlatformRuleManagementCapability,
  PLATFORM_RULE_MANAGEMENT_METHODS,
  PLATFORM_RULE_MANAGEMENT_MODULE_TYPE,
  PLATFORM_RULE_MANAGEMENT_PAGE_PATH,
  PLATFORM_RULE_MANAGEMENT_PERMISSION,
  PLATFORM_RULE_MANAGEMENT_SYSTEM_OPTIONS,
  platformRuleManagementCapabilities,
} from '../src/capabilities/platform-rule-management.js'
import {
  PLATFORM_RULE_MANAGEMENT_AI_CONTRACTS as contracts,
  PLATFORM_RULE_MANAGEMENT_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-platform-rule-management.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createPlatformRuleManagementCapability(request), calls }
}

const row = {
  id: '9007199254740993',
  ruleCode: 'PRICE_RULE',
  ruleName: '报价规则',
  ruleExpression: 'amount > 0',
  ruleDescription: '仅测试',
  ruleType: 'PRICING',
  ruleGroup: 'TRADE',
  enabled: true,
  priority: 10,
  systemType: 10,
  version: 1,
  updateTime: '2026-09-24 10:00:00',
}

const form = {
  id: '',
  ruleCode: 'PRICE_RULE',
  ruleName: '报价规则',
  ruleExpression: 'amount > 0',
  ruleDescription: '仅测试',
  ruleType: 'PRICING',
  ruleGroup: 'TRADE',
  enabled: true,
  priority: 10,
  systemType: 10,
  version: 1,
} as const

describe('平台→规则管理页面能力', () => {
  it('逐页锁定菜单、权限、实例、无module-type和Portal/Java动作边界', () => {
    expect(platformRuleManagementCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_RULE_MANAGEMENT_METHODS))
    expect(platformRuleManagementCapabilities.every(item => item.pagePath === PLATFORM_RULE_MANAGEMENT_PAGE_PATH)).toBe(true)
    expect(platformRuleManagementCapabilities.every(item => item.permission === PLATFORM_RULE_MANAGEMENT_PERMISSION)).toBe(true)
    expect(platformRuleManagementCapabilities.every(item => item.moduleType === PLATFORM_RULE_MANAGEMENT_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(Object.keys(PLATFORM_RULE_MANAGEMENT_METHODS)).not.toContain('platform-rule-management-remove')
    expect(PLATFORM_RULE_MANAGEMENT_SYSTEM_OPTIONS).toEqual([
      { value: 8, label: '科技' },
      { value: 0, label: '公共' },
      { value: 1, label: '人力' },
      { value: 2, label: '财务' },
      { value: 3, label: '资产' },
      { value: 4, label: '生产' },
      { value: 5, label: '采购' },
      { value: 6, label: '销售' },
      { value: 7, label: '门户' },
      { value: 10, label: '平台' },
    ])

    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/mall.v2.js'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/platform/system/express/list.vue'), 'utf8')
    const formPage = readFileSync(join(portalRoot, 'app/portal/views/dashboard/platform/system/express/[mode]/[id].vue'), 'utf8')
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = readFileSync(join(javaRoot, 'erp-module-infra/erp-module-infra-biz/src/main/java/com/wdbc/erp/module/infra/controller/admin/ruleengine/RuleManagementController.java'), 'utf8')
    const saveVo = readFileSync(join(javaRoot, 'erp-module-infra/erp-module-infra-biz/src/main/java/com/wdbc/erp/module/infra/controller/admin/ruleengine/vo/RuleDefinitionSaveReqVO.java'), 'utf8')
    expect(menu).toContain("path: '/dashboard/platform/system/express/list'")
    expect(menu).toContain("permission: '/dashboard/platform/system/express'")
    expect(list).toContain("http('/admin-api/rulesManage/listByPage'")
    expect(list).toContain('cleanParams(params)')
    expect(formPage).toContain("http('/admin-api/rulesManage/get'")
    expect(formPage).toContain("'/admin-api/rulesManage/validate'")
    expect(formPage).toContain("'/admin-api/rulesManage/update'")
    expect(formPage).toContain("'/admin-api/rulesManage/create'")
    expect(controller).toContain('@GetMapping("/listByPage")')
    expect(controller).toContain('@GetMapping("/get")')
    expect(controller).toContain('@PostMapping("/validate")')
    expect(controller).toContain('checkSuperAdminPermission()')
    expect(controller).toContain('仅超级管理员可创建或修改规则')
    expect(saveVo).toContain('@NotBlank(message = "规则编码不能为空")')
    expect(saveVo).toContain('@NotNull(message = "启用状态不能为空")')
  })

  it('列表完全对齐Portal cleanParams和后端分页筛选', async () => {
    const api = setup({ list: [row], total: 1 })
    const result = await api.api.list()
    expect(api.calls[0]).toEqual({
      url: '/admin-api/rulesManage/listByPage',
      method: 'get',
      params: { pageNo: 1, pageSize: 20 },
    })
    expect(result).toEqual({ list: [{ ...row, ruleExpression: row.ruleExpression }], total: 1 })

    const filtered = setup({ list: [], total: 0 })
    await filtered.api.list({
      ruleCode: 'PRICE',
      ruleName: '报价',
      ruleType: 'PRICING',
      ruleGroup: 'TRADE',
      enabled: false,
      systemType: 8,
      order: 'asc',
      orderField: 'priority',
      pageNo: 2,
      pageSize: 50,
    })
    expect(filtered.calls[0]?.params).toEqual({
      order: 'asc',
      orderField: 'priority',
      ruleCode: 'PRICE',
      ruleName: '报价',
      ruleType: 'PRICING',
      ruleGroup: 'TRADE',
      enabled: false,
      systemType: 8,
      pageNo: 2,
      pageSize: 50,
    })
  })

  it('详情归一Portal的转义换行，验证动作只发送expression', async () => {
    const detail = setup({ ...row, systemType: '1', ruleExpression: 'if(a > 0)\\n{return 1}' })
    const result = await detail.api.get({ id: row.id })
    expect(detail.calls[0]).toEqual({ url: '/admin-api/rulesManage/get', method: 'get', params: { id: row.id } })
    expect(result.systemType).toBe(1)
    expect(result.ruleExpression).toBe('if(a > 0)\n{return 1}')

    const validation = setup({ valid: false, message: '语法错误', errors: ['缺少右括号'] })
    await expect(validation.api.validate({ expression: 'if(a > 0)' })).resolves.toEqual({
      valid: false,
      message: '语法错误',
      errors: ['缺少右括号'],
    })
    expect(validation.calls[0]).toEqual({
      url: '/admin-api/rulesManage/validate',
      method: 'post',
      data: { expression: 'if(a > 0)' },
    })
  })

  it('表单必填、键序、创建编辑请求体和取消语义与Portal一致', async () => {
    const api = setup(undefined, undefined)
    const createPreparation = api.api.prepareCreate(form)
    expect(createPreparation).toEqual({
      draft: {
        ruleCode: 'PRICE_RULE',
        ruleName: '报价规则',
        ruleExpression: 'amount > 0',
        ruleDescription: '仅测试',
        ruleType: 'PRICING',
        ruleGroup: 'TRADE',
        enabled: true,
        priority: 10,
        systemType: 10,
        version: 1,
      },
    })
    expect(api.calls).toHaveLength(0)

    await api.api.create(createPreparation)
    expect(api.calls[0]).toEqual({
      url: '/admin-api/rulesManage/create',
      method: 'post',
      data: createPreparation.draft,
    })

    const updatePreparation = api.api.prepareUpdate({ ...form, id: row.id })
    expect(Object.keys(updatePreparation.draft)).toEqual([
      'id', 'ruleCode', 'ruleName', 'ruleExpression', 'ruleDescription', 'ruleType', 'ruleGroup', 'enabled', 'priority', 'systemType', 'version',
    ])
    await api.api.update(updatePreparation)
    expect(api.calls[1]).toEqual({
      url: '/admin-api/rulesManage/update',
      method: 'put',
      data: updatePreparation.draft,
    })

    // Portal 的取消/返回只丢弃本地表单，不发任何 cancel/delete 请求。
    const cancelled = api.api.prepareCreate({ ...form, ruleCode: 'CANCELLED' })
    expect(cancelled.draft.ruleCode).toBe('CANCELLED')
    expect(api.calls).toHaveLength(2)
  })

  it('非法输入、坏响应和后端非数组错误不会被吞掉', async () => {
    const api = setup({ list: [], total: 0 })
    expect(() => api.api.prepareCreate({ ...form, ruleCode: '   ' })).toThrow('ruleCode')
    expect(() => api.api.prepareCreate({ ...form, enabled: undefined as never })).toThrow('enabled')
    expect(() => api.api.prepareUpdate({ ...form, id: '' })).toThrow('id')
    await expect(api.api.validate({ expression: '   ' })).rejects.toThrow('规则表达式')
    expect(api.calls).toHaveLength(0)

    const badPage = setup({ list: [{ ...row, priority: '10' }], total: 1 })
    await expect(badPage.api.list()).rejects.toThrow('priority')
    const badValidation = setup({ valid: 'false', message: null, errors: null })
    await expect(badValidation.api.validate({ expression: 'a' })).rejects.toThrow('valid')
  })
})

describe('规则管理AI契约', () => {
  it('每个页面能力都有结构化契约，且方法路径使用SDK门面名', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(Object.keys(contracts)).toEqual(Object.keys(PLATFORM_RULE_MANAGEMENT_METHODS))
    expect(validateAiContracts(contracts, { definitions: platformRuleManagementCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: platformRuleManagementCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(Object.keys(contracts).length).fill('incomplete-evidence'))
    expect(Object.keys(methodContracts)).toEqual(Object.values(PLATFORM_RULE_MANAGEMENT_METHODS).map(method => `platformRuleManagement.${method}`))
    expect(Object.values(contracts).every(contract => contract.gaps?.some(gap => gap.includes('尚未在真实测试环境')))).toBe(true)
  })

  it('契约锁住字段规则、超级管理员权限和不暴露删除接口', () => {
    const text = Object.values(contracts).map(contract => `${contract.purpose} ${contract.boundaries.join(' ')} ${contract.consume.join(' ')}`).join('\n')
    expect(text).toContain('超级管理员')
    expect(text).toContain('不把这些后端接口冒充本页能力')
    expect(contracts['platform-rule-management-prepare-create']?.output.fields.find(field => field.path === 'draft.systemType')?.meaning).toContain('SYSTEM_OPTIONS_ALL')
    expect(contracts['platform-rule-management-validate']?.output.fields.find(field => field.path === 'valid')?.type).toBe('boolean')
    expect(methodContracts['platformRuleManagement.create']?.boundaries.join(' ')).toContain('写方法只接受对应prepare方法生成的draft')
  })
})
