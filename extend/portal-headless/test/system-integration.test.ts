import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCatalog } from '../src/catalog/index.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'
import {
  SYSTEM_INTEGRATION_METHODS,
  SYSTEM_INTEGRATION_MODULE_TYPE,
  SYSTEM_INTEGRATION_PAGE_PATH,
  SYSTEM_INTEGRATION_PERMISSION,
  createSystemIntegrationCapability,
  systemIntegrationCapabilities,
} from '../src/capabilities/system-integration.js'
import { SYSTEM_INTEGRATION_AI_CONTRACTS as contracts } from '../src/catalog/contracts-system-integration.js'
import { sdkPathOf } from '../src/capabilities/invoke.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSystemIntegrationCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const row = {
  id: '9007199254740993',
  orgId: 101,
  orgName: '总部',
  orgFullPath: '集团/总部',
  hrEnabled: 1,
  financeEnabled: 0,
  inventoryEnabled: true,
  productionEnabled: false,
  supplyEnabled: null,
  salesEnabled: 1,
  remark: '集成配置',
  createTime: '2026-09-24 10:00:00',
  updateTime: '2026-09-24 11:00:00',
}

describe('Portal 系统设置 → 系统开通页面能力', () => {
  it('逐页锁定范围、菜单权限、真实端点和页面按钮', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/setting/integration/list.vue')
    const form = read(portalRoot, 'app/portal/views/dashboard/hr/setting/integration/[mode]/[id].vue')
    for (const fragment of [`path: '${SYSTEM_INTEGRATION_PAGE_PATH}'`, `permission: '${SYSTEM_INTEGRATION_PERMISSION}'`]) expect(menu).toContain(fragment)
    for (const fragment of [
      'customLoad: async form =>',
      "'/admin-api/system/org-module-switch/page'",
      'getDataListIsPage: true',
      'styleV2: true',
      'actionCreate()',
      'actionEdit(record)',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/org-module-switch/get'",
      "'/admin-api/system/org-module-switch/batch-config'",
      'normalizeFromApi',
      'boolToInt',
      ':maxlength="200"',
      'required: true',
    ]) expect(form).toContain(fragment)
    expect(list).not.toContain('actionDelete')
    expect(list).not.toContain('exportURL')
    expect(systemIntegrationCapabilities.map(item => item.id)).toEqual(Object.keys(SYSTEM_INTEGRATION_METHODS))
    expect(systemIntegrationCapabilities.every(item => item.pagePath === SYSTEM_INTEGRATION_PAGE_PATH && item.permission === SYSTEM_INTEGRATION_PERMISSION && item.moduleType === SYSTEM_INTEGRATION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(systemIntegrationCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'system-integration-create',
      'system-integration-update',
    ])
  })

  it('逐页锁定Java路由、DTO字段和不纳入的隐藏接口', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/module/OrgModuleSwitchController.java')
    const pageReq = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/module/vo/OrgModuleSwitchPageReqVO.java')
    const saveReq = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/module/vo/OrgModuleSwitchBatchConfigReqVO.java')
    const response = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/module/vo/OrgModuleSwitchRespVO.java')
    for (const fragment of ['@RequestMapping("/system/org-module-switch")', '@GetMapping("/get")', '@GetMapping("/page")', '@PostMapping("/batch-config")', '@GetMapping("/list")', '@PostMapping("/batch-config-by-string")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long orgId', 'private Integer hrEnabled', 'private Integer financeEnabled', 'private Integer inventoryEnabled', 'private Integer productionEnabled', 'private Integer supplyEnabled', 'private Integer salesEnabled', 'private String remark']) expect(saveReq).toContain(fragment)
    for (const fragment of ['private Long orgId', 'extends PageParam']) expect(pageReq).toContain(fragment)
    for (const fragment of ['private Long id', 'private String orgName', 'private String orgFullPath', 'private Integer productionEnabled', 'private LocalDateTime updateTime']) expect(response).toContain(fragment)
    expect(contracts['system-integration-list']?.boundaries.join(' ')).toContain('独立生产')
    expect(contracts['system-integration-list']?.boundaries.join(' ')).toContain('productionEnabled')
    expect(contracts['system-integration-list']?.boundaries.join(' ')).toContain('batch-config-by-string')
  })

  it('列表严格复刻Portal的order、orgId、pageNo和limit参数', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ orgId: 101, pageNo: 2, limit: 50 })).resolves.toEqual({
      list: [{ ...row, id: '9007199254740993', inventoryEnabled: 1, productionEnabled: 0, supplyEnabled: null }],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/system/org-module-switch/page',
      method: 'get',
      params: { order: '', orderField: '', orgId: 101, pageNo: 2, limit: 50 },
    })
    const empty = fixture([{ list: [], total: 0 }])
    await expect(empty.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(empty.calls[0]).toEqual({
      url: '/admin-api/system/org-module-switch/page',
      method: 'get',
      params: { order: '', orderField: '', orgId: null, pageNo: 1, limit: 20 },
    })
  })

  it('详情按Portal规则把六个开关归一为布尔值，并固定orgId查询', async () => {
    const f = fixture([row])
    await expect(f.api.get({ orgId: 101 })).resolves.toEqual({
      id: '9007199254740993',
      orgId: 101,
      orgName: '总部',
      orgFullPath: '集团/总部',
      hrEnabled: true,
      financeEnabled: false,
      inventoryEnabled: true,
      productionEnabled: false,
      supplyEnabled: false,
      salesEnabled: true,
      remark: '集成配置',
    })
    expect(f.calls).toEqual([{ url: '/admin-api/system/org-module-switch/get', method: 'get', params: { orgId: 101 } }])
  })

  it('prepare不发请求，create/update只提交完整八字段并返回影响条数', async () => {
    const f = fixture([3, 2])
    const form = {
      id: '9007199254740993',
      orgId: 101,
      orgName: '总部',
      orgFullPath: '集团/总部',
      hrEnabled: true,
      financeEnabled: false,
      inventoryEnabled: 1 as const,
      productionEnabled: 0 as const,
      supplyEnabled: undefined,
      salesEnabled: true,
      remark: '保存',
      ignored: 'must-not-cross-wire',
    }
    const created = f.api.prepareCreate(form)
    expect(created).toEqual({ draft: {
      orgId: 101,
      hrEnabled: 1,
      financeEnabled: 0,
      inventoryEnabled: 1,
      productionEnabled: 0,
      supplyEnabled: 0,
      salesEnabled: 1,
      remark: '保存',
    } })
    const updated = f.api.prepareUpdate(form)
    expect(updated).toEqual(created)
    expect(f.calls).toHaveLength(0)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(3)
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(2)
    expect(f.calls).toEqual([
      { url: '/admin-api/system/org-module-switch/batch-config', method: 'post', data: created.draft },
      { url: '/admin-api/system/org-module-switch/batch-config', method: 'post', data: updated.draft },
    ])
  })

  it('Portal表单校验、分页选项、完整字段和非负整数回执不能被放松', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ orgId: 0 })).toThrow('orgId')
    expect(() => f.api.prepareCreate({ orgId: 101, hrEnabled: 2 as never })).toThrow('hrEnabled')
    expect(() => f.api.prepareCreate({ orgId: 101, remark: 'x'.repeat(201) })).toThrow('备注')
    expect(() => f.api.prepareUpdate({ orgId: 101 } as never)).toThrow('id')
    await expect(f.api.list({ limit: 30 })).rejects.toThrow('10、20、50或100')
    await expect(f.api.list({ pageNo: 0 })).rejects.toThrow('pageNo')
    expect(f.calls).toHaveLength(0)
    await expect(fixture(['3']).api.create({ draft: { orgId: 101 } as never })).rejects.toThrow('非负整数')
    await expect(fixture([-1]).api.update({ draft: { orgId: 101 } as never })).rejects.toThrow('非负整数')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
  })

  it('AI说明完整覆盖能力、回查、取消和范围反证', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SYSTEM_INTEGRATION_METHODS).sort())
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    const bindings = new Map(systemIntegrationCapabilities.map(definition => [definition.id, sdkPathOf(definition.id)!]))
    expect(validateAiContracts(contracts, { definitions: systemIntegrationCapabilities, bindings })).toEqual([])
    const broken = structuredClone(contracts)
    const listStep = broken['system-integration-list']!.steps.find(step => step.capabilityId === 'system-integration-get')!
    listStep.mapping!.orgId = 'result.list[].missingOrgId'
    expect(validateAiContracts(broken, { definitions: systemIntegrationCapabilities, bindings })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-source-field' })]))
    expect(contracts['system-integration-prepare-update']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['system-integration-update']?.steps.some(step => step.capabilityId === 'system-integration-get')).toBe(true)
    expect(contracts['system-integration-update']?.boundaries.join(' ')).toContain('productionEnabled')
    const catalog = createCatalog({ capabilities: systemIntegrationCapabilities })
    expect(catalog.describe('system-integration-list')).toMatchObject({ ok: true })
    expect(catalog.describe('system-integration-list-llm')).toMatchObject({ ok: true })
  })
})
