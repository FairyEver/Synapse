import { describe, expect, it } from 'vitest'

import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import {
  createPerfManageConfigCapability,
} from '../src/capabilities/perf-manage-config.js'
import {
  createRecruitmentPlanCapability,
  type RecruitmentPlanDraft,
} from '../src/capabilities/recruitment-plan.js'
import type { PortalRequest } from '../src/session/types.js'
import { CAPABILITY_BINDINGS, sdkPathOf } from '../src/capabilities/invoke.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import { resolveModuleType } from '../src/context/module-type.js'

/**
 * 这是范围审计证据：覆盖目录/绑定和 mock request 投影。
 * 它不代表浏览器基准或真实测试环境验证。
 */
const PAGE_CAPABILITIES = [
  {
    pagePath: '/dashboard/staff/recruitment-plan/list',
    permission: '/dashboard/staff/recruitment-plan',
    httpInstance: 'platform',
    moduleType: 11,
    ids: [
      'recruitment-plan-list',
      'recruitment-plan-get',
      'recruitment-plan-organization-tree',
      'recruitment-plan-post-options',
      'recruitment-plan-salary-level-options',
      'recruitment-plan-prepare',
      'recruitment-plan-create',
      'recruitment-plan-prepare-update',
      'recruitment-plan-update',
      'recruitment-plan-cancel',
      'recruitment-plan-prepare-delete',
      'recruitment-plan-remove',
      'recruitment-plan-download-template',
      'recruitment-plan-prepare-import',
      'recruitment-plan-import',
      'recruitment-plan-resume-list',
      'recruitment-plan-resume-prepare-create',
      'recruitment-plan-resume-create',
      'recruitment-plan-resume-prepare-update',
      'recruitment-plan-resume-update',
      'recruitment-plan-resume-prepare-delete',
      'recruitment-plan-resume-remove',
      'recruitment-plan-resume-download-template',
      'recruitment-plan-resume-prepare-import',
      'recruitment-plan-resume-import',
      'recruitment-plan-prepare-onboarding',
      'recruitment-plan-interview-list',
      'recruitment-plan-interview-prepare-create',
      'recruitment-plan-interview-create',
      'recruitment-plan-interview-prepare-update',
      'recruitment-plan-interview-update',
      'recruitment-plan-interview-prepare-delete',
      'recruitment-plan-interview-remove',
    ],
  },
  {
    pagePath: '/dashboard/manage/indicator/list',
    permission: '/dashboard/manage/indicator',
    httpInstance: 'platform',
    moduleType: 13,
    ids: [
      'perf-manage-indicator-list',
      'perf-manage-indicator-prepare-save-data',
      'perf-manage-indicator-save-data',
      'perf-manage-indicator-cancel-save-data',
      'perf-manage-indicator-prepare-import',
      'perf-manage-indicator-import',
      'perf-manage-indicator-prepare-status',
      'perf-manage-indicator-update-status',
      'perf-manage-indicator-prepare-delete',
      'perf-manage-indicator-delete',
    ],
  },
  {
    pagePath: '/dashboard/manage/standard/list',
    permission: '/dashboard/manage/standard',
    httpInstance: 'platform',
    moduleType: 13,
    ids: [
      'perf-manage-standard-list',
      'perf-manage-standard-prepare-save-data',
      'perf-manage-standard-save-data',
      'perf-manage-standard-cancel-save-data',
      'perf-manage-standard-prepare-import',
      'perf-manage-standard-import',
      'perf-manage-standard-prepare-delete',
      'perf-manage-standard-delete',
    ],
  },
  {
    pagePath: '/dashboard/manage/protocol-deduct-rule/list',
    permission: '/dashboard/manage/protocol-deduct-rule',
    httpInstance: 'platform',
    moduleType: 13,
    ids: ['perf-manage-protocol-deduct-rule-list', 'perf-manage-protocol-deduct-rule-update'],
  },
] as const

const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })

function requestHarness (responses: unknown[] = []) {
  const calls: Array<Record<string, unknown>> = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
    calls.push(config as unknown as Record<string, unknown>)
    return responses.shift() as T
  }
  return { calls, request }
}

function recruitmentDraft (): RecruitmentPlanDraft {
  return {
    recruitmentType: 1,
    planYear: 2026,
    organizationId: 101,
    organizationName: '华东组织',
    postId: 202,
    postName: '研发工程师',
    planNumber: 2,
    purpose: '业务扩编',
    requirementText: '熟悉业务系统',
    salaryLevelMin: 3,
    salaryLevelMax: 5,
    urgency: '常规',
    arrivalDate: '2026-10-01',
    remark: '',
  }
}

describe('范围审计：招聘计划与绩效管理四页', () => {
  it('逐页能力集合非空，且每个 ID 的 pagePath 精确匹配页面', () => {
    for (const page of PAGE_CAPABILITIES) {
      const definitions = ALL_CAPABILITY_DEFINITIONS.filter(
        definition => definition.pagePath === page.pagePath,
      )
      expect(definitions.length, page.pagePath).toBeGreaterThan(0)
      expect(definitions.map(definition => definition.id).sort()).toEqual([...page.ids].sort())
      const http = resolveHttpInstance({ pagePath: page.pagePath })
      expect(http.kind, page.pagePath).toBe('resolved')
      if (http.kind !== 'resolved') continue
      expect(http.instance.id, page.pagePath).toBe(page.httpInstance)
      expect(resolveModuleType(page.pagePath).moduleType, page.pagePath).toBe(page.moduleType)
      for (const definition of definitions) {
        expect(definition.pagePath).toBe(page.pagePath)
        expect(definition.permission).toBe(page.permission)
        expect(definition.httpInstance === undefined ? http.instance.id : definition.httpInstance).toBe(page.httpInstance)
        expect(definition.moduleType === undefined ? resolveModuleType(page.pagePath).moduleType : definition.moduleType).toBe(page.moduleType)
      }
    }

    expect(PAGE_CAPABILITIES.map(page => page.pagePath)).toEqual([
      '/dashboard/staff/recruitment-plan/list',
      '/dashboard/manage/indicator/list',
      '/dashboard/manage/standard/list',
      '/dashboard/manage/protocol-deduct-rule/list',
    ])
  })

  it('逐个能力实际返回 AI 说明，并闭合 catalog describe 与执行绑定', () => {
    for (const page of PAGE_CAPABILITIES) {
      for (const id of page.ids) {
        const description = catalog.describe(id)
        expect(description.ok, id).toBe(true)
        if (!description.ok) throw new Error(`能力描述失败：${id}`)

        const sdkPath = sdkPathOf(id)
        expect(description.ai, id).toBeDefined()
        expect(sdkPath, id).not.toBeNull()
        expect(description.invoke).toMatchObject({ capabilityId: id, sdkPath })
        expect(CAPABILITY_BINDINGS.find(binding => binding.capabilityId === id), id).toMatchObject({
          capabilityId: id,
          sdkPath,
        })
        expect(catalog.describe(`${id}-llm`), id).toMatchObject({
          ok: true,
          ai: description.ai,
          invoke: { capabilityId: id, sdkPath },
        })
      }
    }

    expect(catalog.describe('recruitment-plan-create')).toMatchObject({
      ai: {
        effect: 'write',
        steps: expect.arrayContaining([
          expect.objectContaining({
            capabilityId: 'recruitment-plan-get',
            mapping: { id: 'result.$' },
          }),
        ]),
      },
    })
    const createDescription = catalog.describe('recruitment-plan-create')
    expect(createDescription.ok, 'recruitment-plan-create').toBe(true)
    if (createDescription.ok) expect(createDescription.ai?.gaps).toEqual(expect.any(Array))
    expect(catalog.describe('perf-manage-indicator-list')).toMatchObject({ ai: { output: { shape: 'object[]' } } })
  })

  it('招聘计划 prepare → create 映射完整草稿和审批人节点；状态不符的撤销不发请求', async () => {
    const tasks = [{ id: 'Activity_1', minSelectCount: 1, maxSelectCount: 1 }]
    const { calls, request } = requestHarness([tasks, 77, true])
    const api = createRecruitmentPlanCapability(request)
    const draft = recruitmentDraft()

    const prepared = await api.prepare(draft)
    expect(prepared).toEqual({ payload: draft, tasks })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      url: '/hr/recruitment-plan/getRequiredStartUserSelectTasks',
      method: 'post',
      data: draft,
    })

    await expect(api.create({
      draft,
      tasks: prepared.tasks,
      startUserSelectAssignees: { Activity_1: [9001] },
    })).resolves.toBe(77)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({
      url: '/hr/recruitment-plan/create',
      method: 'post',
      data: { ...draft, overwrite: false, startUserSelectAssignees: { Activity_1: [9001] } },
    })

    await expect(api.cancel({ id: 77, currentStatus: 2 })).rejects.toThrow('只有status=1')
    expect(calls).toHaveLength(2)
    await expect(api.cancel({ id: 77, currentStatus: 1 })).resolves.toBe(true)
    expect(calls).toHaveLength(3)
    expect(calls[2]).toEqual({
      url: '/hr/recruitment-plan/cancel/77',
      method: 'post',
    })
  })

  it('绩效管理三页保留页面特有的列表与状态参数映射', async () => {
    const { calls, request } = requestHarness([
      [],
      { list: [], total: 0 },
      { rules: [], enabledCount: 0, annualRuleCount: 0, monthlyRuleCount: 0 },
      { ruleCode: 'MONTH_PROTOCOL_SCORE', enabled: 1 },
      [],
    ])
    const api = createPerfManageConfigCapability(request, request, request, request, request, request)

    await api.listIndicators({ targetType: 2 })
    expect(calls[0]).toMatchObject({
      url: '/performance/basedata/kpitarget/page',
      method: 'get',
      params: { name: '', creatorName: '', targetType: 2, type: '' },
    })

    await api.listStandards({ parentId: 4242, keyword: '  蛋鸡  ', pageNo: 2, pageSize: 50 })
    expect(calls[1]).toMatchObject({
      url: '/performance/kpistandard/searchPage',
      method: 'get',
      params: {
        parentId: 4242,
        keyword: '蛋鸡',
        dataType: 2,
        selection: false,
        pageNo: 2,
        pageSize: 50,
      },
    })

    await api.listProtocolDeductRules()
    expect(calls[2]).toMatchObject({
      url: '/performance/basedata/protocol-deduct-rule/list',
      method: 'get',
    })
    expect(calls[2]).not.toHaveProperty('params')

    await api.getProtocolDeductRule('MONTH_PROTOCOL_SCORE')
    expect(calls[3]).toMatchObject({
      url: '/performance/basedata/protocol-deduct-rule/get',
      method: 'get',
      params: { ruleCode: 'MONTH_PROTOCOL_SCORE' },
    })
    await api.listProtocolDeductRuleHistory('MONTH_PROTOCOL_SCORE')
    expect(calls[4]).toMatchObject({
      url: '/performance/basedata/protocol-deduct-rule/history',
      method: 'get',
      params: { ruleCode: 'MONTH_PROTOCOL_SCORE' },
    })
  })
})
