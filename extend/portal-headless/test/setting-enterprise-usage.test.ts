import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AxiosResponse } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import type { PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  SETTING_ENTERPRISE_USAGE_BUTTON_PERMISSIONS,
  SETTING_ENTERPRISE_USAGE_MODULE_TYPE,
  SETTING_ENTERPRISE_USAGE_PAGE_PATH,
  SETTING_ENTERPRISE_USAGE_PATHS,
  SETTING_ENTERPRISE_USAGE_PERMISSION,
  createSettingEnterpriseUsageCapability,
  prepareEnterpriseApply,
  settingEnterpriseUsageCapabilities,
} from '../src/capabilities/setting-enterprise-usage.js'
import { SETTING_ENTERPRISE_USAGE_AI_CONTRACTS } from '../src/catalog/contracts-setting-enterprise-usage.js'

const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href

type Call = PortalRequestConfig

function makeCapability () {
  const calls: Call[] = []
  const request = vi.fn(async <T,>(config: PortalRequestConfig): Promise<T> => {
    calls.push(config)
    if (config.url === SETTING_ENTERPRISE_USAGE_PATHS.usageTrend) throw new Error('trend down')
    if (config.responseType === 'arraybuffer') {
      return {
        data: new Uint8Array([1, 2, 3]).buffer,
        headers: {
          'content-disposition': "attachment; filename*=UTF-8''模型用量明细.xls",
          'content-type': 'application/vnd.ms-excel',
        },
      } as unknown as AxiosResponse<ArrayBuffer> as T
    }
    if (config.method === 'post') return 902 as T
    if (config.url === SETTING_ENTERPRISE_USAGE_PATHS.functionModuleList) return ['智能助手', '报表分析'] as T
    if (config.url === SETTING_ENTERPRISE_USAGE_PATHS.applyPage) return { list: [{ id: 1, status: 0 }], total: 1 } as T
    if (config.url === SETTING_ENTERPRISE_USAGE_PATHS.usagePage) return { list: [{ id: 8, modelName: '模型A' }], total: 1 } as T
    if (config.url === SETTING_ENTERPRISE_USAGE_PATHS.quotaPage) return { list: [{ modelId: 7, modelName: '模型A' }], total: 1 } as T
    if (config.url === `${SETTING_ENTERPRISE_USAGE_PATHS.modelDetail}/7`) return { id: 7, modelName: '模型A' } as T
    if (config.url === SETTING_ENTERPRISE_USAGE_PATHS.usageDetail) return { id: 8, callStatus: 1 } as T
    return { cycleTotalQuota: 10, cycleUsedQuota: 2, cycleRemainingQuota: 8, currentCycleAvailableQuota: 8 } as T
  })
  return { calls, request: request as unknown as PortalRequest, cap: createSettingEnterpriseUsageCapability(request as unknown as PortalRequest) }
}

describe('企业用量：Portal页面、Java权限与SDK范围逐页对齐', () => {
  it('菜单、页面入口和共享组件固定企业维度，未引入平台筛选或失效端点', () => {
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/common.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/setting/enterprise-usage/list.vue'), 'utf8')
    const content = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/components/ModelUsageContent.vue'), 'utf8')
    const quota = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/components/QuotaTab.vue'), 'utf8')
    const usage = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/components/UsageTab.vue'), 'utf8')
    const api = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/api.js'), 'utf8')

    expect(menu).toContain("path: '/dashboard/setting/enterprise-usage/list'")
    expect(menu).toContain("permission: '/dashboard/setting/enterprise-usage'")
    expect(page).toContain('企业用量')
    expect(page).toContain('STATISTICS_DIMENSION.enterprise')
    expect(page).toContain("buttonPermissionFlag('ai-token:usage:query')")
    expect(content).toContain("buttonPermissionFlag('ai-token:apply:query')")
    expect(quota).toContain('statisticsDimension !== STATISTICS_DIMENSION.platform')
    expect(usage).toContain('showUsageDetailFilters')
    expect(usage).toContain('quotaDeducted')
    expect(usage).toContain('exportUsageData')
    expect(api).toContain('/ai-token/usage/export')
    expect(api).toContain('/ai-token/apply/create')
    expect(api).toContain('/ai-token/apply/page')
    expect(api).toContain('daily-progress')
    expect(SETTING_ENTERPRISE_USAGE_PATHS).not.toHaveProperty('dailyProgress')

    expect(SETTING_ENTERPRISE_USAGE_PAGE_PATH).toBe('/dashboard/setting/enterprise-usage/list')
    expect(SETTING_ENTERPRISE_USAGE_PERMISSION).toBe('/dashboard/setting/enterprise-usage')
    expect(SETTING_ENTERPRISE_USAGE_MODULE_TYPE).toBeNull()
  })

  it('能力定义固定页面上下文，按钮权限和写能力边界与页面一致', () => {
    expect(settingEnterpriseUsageCapabilities).toHaveLength(12)
    expect(new Set(settingEnterpriseUsageCapabilities.map(item => item.id)).size).toBe(12)
    for (const item of settingEnterpriseUsageCapabilities) {
      expect(item.pagePath, item.id).toBe(SETTING_ENTERPRISE_USAGE_PAGE_PATH)
      expect(item.permission, item.id).toBe(SETTING_ENTERPRISE_USAGE_PERMISSION)
      expect(item.moduleType, item.id).toBeNull()
      expect(item.httpInstance, item.id).toBe('platform')
      expect(resolveModuleType(item.pagePath).moduleType, item.id).toBeNull()
    }
    expect(SETTING_ENTERPRISE_USAGE_BUTTON_PERMISSIONS).toEqual({ query: 'ai-token:usage:query', applyQuery: 'ai-token:apply:query' })
    expect(settingEnterpriseUsageCapabilities.filter(item => item.write).map(item => item.id)).toEqual(['setting-enterprise-usage-apply-submit'])
  })

  it('Java端点、权限、统计维度和DTO校验与页面请求一一对应', () => {
    const tokenRoot = 'erp-module-ai/erp-module-ai-biz/src/main/java/com/wdbc/erp/module/ai/controller/admin/token'
    const quotaController = readFileSync(join(javaRoot, `${tokenRoot}/AiTokenQuotaUsageController.java`), 'utf8')
    const usageController = readFileSync(join(javaRoot, `${tokenRoot}/AiTokenUsageController.java`), 'utf8')
    const applyController = readFileSync(join(javaRoot, `${tokenRoot}/AiTokenQuotaApplyController.java`), 'utf8')
    const quotaReq = readFileSync(join(javaRoot, `${tokenRoot}/vo/AiTokenQuotaUsagePageReqVO.java`), 'utf8')
    const quotaResp = readFileSync(join(javaRoot, `${tokenRoot}/vo/AiTokenQuotaUsageRespVO.java`), 'utf8')
    const usageReq = readFileSync(join(javaRoot, `${tokenRoot}/vo/AiTokenUsageQueryReqVO.java`), 'utf8')
    const usageResp = readFileSync(join(javaRoot, `${tokenRoot}/vo/AiTokenUsageRecordRespVO.java`), 'utf8')
    const usageDo = readFileSync(join(javaRoot, 'erp-module-ai/erp-module-ai-biz/src/main/java/com/wdbc/erp/module/ai/dal/dataobject/token/AiTokenUsageRecordDO.java'), 'utf8')
    const applyReq = readFileSync(join(javaRoot, `${tokenRoot}/vo/AiTokenQuotaApplySaveReqVO.java`), 'utf8')
    const applyPageReq = readFileSync(join(javaRoot, `${tokenRoot}/vo/AiTokenQuotaApplyPageReqVO.java`), 'utf8')

    for (const endpoint of ['/page', '/summary']) expect(quotaController).toContain(`@GetMapping("${endpoint}")`)
    expect(quotaController).toContain("@PreAuthorize(\"@ss.hasPermission('ai-token:usage:query')\")")
    for (const endpoint of ['/page', '/export', '/detail', '/summary', '/trend', '/model-ratio', '/module-ranking']) {
      expect(usageController).toContain(`@GetMapping("${endpoint}")`)
    }
    expect(usageController).toContain("@PreAuthorize(\"@ss.hasPermission('ai-token:usage:query')\")")
    expect(applyController).toContain('@PostMapping("/create")')
    expect(applyController).toContain('@PermitAll')
    expect(applyController).toContain('@GetMapping("/page")')
    expect(applyController).toContain("@ss.hasPermission('ai-token:apply:query')")
    for (const field of ['modelId', 'quotaCycle', 'statisticsDimension', 'usageStatus', 'userName']) expect(quotaReq).toContain(field)
    for (const field of ['modelId', 'modelName', 'tenantName', 'cycleQuota', 'usedQuota', 'remainingQuota', 'usageRate', 'maxTokenPerRequest', 'usageStatusName']) expect(quotaResp).toContain(field)
    for (const field of ['requestId', 'modelId', 'userName', 'userBelong', 'memberLevel', 'functionModule', 'callStatus', 'limitType', 'quotaDeducted', 'startTime', 'endTime', 'statisticsDimension']) expect(usageReq).toContain(field)
    for (const field of ['modelName', 'tenantName', 'userName', 'userBelongName', 'memberLevelName', 'callStatusName', 'durationMsStr', 'tokenLimitPerMinute', 'flowLimited']) expect(usageResp).toContain(field)
    for (const field of ['id', 'requestId', 'modelId', 'functionModule', 'callStatus', 'durationMs', 'failureReason', 'consumedQuota', 'quotaAfter']) expect(usageDo).toContain(field)
    expect(applyReq).toContain('@NotNull(message = "模型编号不能为空")')
    expect(applyReq).toContain('@NotNull(message = "期望月额度不能为空")')
    expect(applyReq).toContain('@Positive(message = "期望月额度必须大于 0")')
    expect(applyReq).toContain('@NotBlank(message = "申请原因不能为空")')
    expect(applyPageReq).toContain('statisticsDimension')
  })

  it('额度列表、汇总和企业用量列表严格固定statisticsDimension=2并保留页面默认值', async () => {
    const { calls, cap } = makeCapability()
    await cap.listQuota({ modelName: '', userName: '张三', usageStatus: 0 })
    expect(calls[0]?.params).toEqual({ quotaCycle: 3, statisticsDimension: 2, usageStatus: 0, userName: '张三', pageNo: 1, pageSize: 20 })
    await cap.getQuotaSummary({ pageNo: 9, pageSize: 99 })
    expect(calls[1]?.params).toEqual({ quotaCycle: 3, statisticsDimension: 2 })
    await cap.listUsage({
      dateRange: ['2026-09-01', '2026-09-07'],
      modelId: 7,
      requestId: 'req-1',
      userName: '张三',
      userBelong: 2,
      memberLevel: 3,
      limitType: 'FLOW',
      quotaDeducted: false,
    })
    expect(calls[2]?.params).toEqual({
      quotaCycle: 2,
      timeRangeType: 2,
      statisticsDimension: 2,
      startTime: '2026-09-01 00:00:00',
      endTime: '2026-09-07 23:59:59',
      requestId: 'req-1',
      modelId: 7,
      userName: '张三',
      userBelong: 2,
      memberLevel: 3,
      limitType: 'FLOW',
      quotaDeducted: false,
      pageNo: 1,
      pageSize: 20,
    })
  })

  it('分析请求按页面并行拆分，单个统计失败保留其它结果和错误映射', async () => {
    const { calls, cap } = makeCapability()
    const analytics = await cap.usageAnalytics({ dateRange: ['2026-09-01', '2026-09-07'] })
    expect(calls.map(item => item.url)).toEqual([
      SETTING_ENTERPRISE_USAGE_PATHS.usageSummary,
      SETTING_ENTERPRISE_USAGE_PATHS.usageTrend,
      SETTING_ENTERPRISE_USAGE_PATHS.usageModelRatio,
      SETTING_ENTERPRISE_USAGE_PATHS.usageModuleRanking,
    ])
    expect(calls[0]?.params).toEqual({
      quotaCycle: 2,
      timeRangeType: 2,
      statisticsDimension: 2,
      startTime: '2026-09-01 00:00:00',
      endTime: '2026-09-07 23:59:59',
    })
    expect(analytics.summary).toEqual({ cycleTotalQuota: 10, cycleUsedQuota: 2, cycleRemainingQuota: 8, currentCycleAvailableQuota: 8 })
    expect(analytics.trend).toBeNull()
    expect(analytics.errors).toEqual({ trend: 'trend down' })

    const before = calls.length
    await cap.usageAnalytics({ modelId: 7 }, { includeBreakdowns: false })
    expect(calls.slice(before).map(item => item.url)).toEqual([SETTING_ENTERPRISE_USAGE_PATHS.usageSummary])
  })

  it('功能模块候选本地筛选，模型ID和用量记录ID分开校验，导出保持二进制响应', async () => {
    const { calls, cap } = makeCapability()
    await expect(cap.listFunctionModules({ keyword: '报表' })).resolves.toEqual(['报表分析'])
    await expect(cap.getUsageDetail('')).rejects.toThrow('不能为空')
    await cap.getUsageDetail(8)
    await cap.getModelDetail(7)
    const file = await cap.exportUsage({ modelId: 7 })
    expect(calls[0]).toMatchObject({ url: SETTING_ENTERPRISE_USAGE_PATHS.functionModuleList, method: 'get' })
    expect(calls[0]?.params).toBeUndefined()
    expect(calls[1]).toMatchObject({ url: SETTING_ENTERPRISE_USAGE_PATHS.usageDetail, method: 'get', params: { id: 8 } })
    expect(calls[2]).toMatchObject({ url: `${SETTING_ENTERPRISE_USAGE_PATHS.modelDetail}/7`, method: 'get' })
    expect(calls[3]).toMatchObject({ url: SETTING_ENTERPRISE_USAGE_PATHS.usageExport, method: 'get', responseType: 'arraybuffer' })
    expect(calls[3]?.params).toEqual({ quotaCycle: 2, timeRangeType: 2, statisticsDimension: 2, modelId: 7 })
    expect(file).toMatchObject({ fileName: '模型用量明细.xls', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
  })

  it('申请表单规则、字段映射、申请记录日期和提交前取消语义与Portal一致', async () => {
    expect(() => prepareEnterpriseApply({ modelId: 7, reason: 'x' })).toThrow('至少填写一个')
    expect(() => prepareEnterpriseApply({ modelId: 7, expectedMaxToken: -1, reason: 'x' })).toThrow('整数')
    expect(() => prepareEnterpriseApply({ modelId: 7, expectedMaxToken: 100, reason: 'x'.repeat(201) })).toThrow('200')
    const prepared = prepareEnterpriseApply({ modelId: 7, modelName: '不能提交', monthlyQuota: 10, expectedMaxToken: 100, reason: '需要更高上限' })
    expect(prepared.payload).toEqual({ modelId: 7, currentMonthlyQuota: 10, expectedMaxToken: 100, statisticsDimension: 2, reason: '需要更高上限' })
    expect(prepared.payload).not.toHaveProperty('modelName')
    expect(prepared.warnings).toHaveLength(1)

    const { calls, cap } = makeCapability()
    await expect(cap.submitApply({ modelId: 7, expectedMonthlyQuota: 200, reason: '申请' })).resolves.toBe(902)
    expect(calls[0]).toMatchObject({ url: SETTING_ENTERPRISE_USAGE_PATHS.applyCreate, method: 'post', data: { modelId: 7, expectedMonthlyQuota: 200, statisticsDimension: 2, reason: '申请' } })
    await cap.listApplyRecords({ modelId: 7, status: 0, dateRange: ['2026-09-01', '2026-09-30'] })
    expect(calls[1]?.params).toEqual({ modelId: 7, status: 0, statisticsDimension: 2, startDate: '2026-09-01', endDate: '2026-09-30', pageNo: 1, pageSize: 20 })
    expect(cap.cancelApply()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(2)
  })

  it('AI契约结构完整，并用反证锁住关键字段和提交步骤映射', async () => {
    const { validateAiContract, validateAiContracts } = await import(validatorUrl)
    const structural = validateAiContracts(SETTING_ENTERPRISE_USAGE_AI_CONTRACTS, {
      profile: 'structural',
      definitions: settingEnterpriseUsageCapabilities,
      contracts: SETTING_ENTERPRISE_USAGE_AI_CONTRACTS,
    })
    expect(structural).toEqual([])

    const broken = structuredClone(SETTING_ENTERPRISE_USAGE_AI_CONTRACTS['setting-enterprise-usage-quota-list']!)
    delete (broken as { purpose?: string }).purpose
    const issues = validateAiContract('setting-enterprise-usage-quota-list', broken, {
      profile: 'structural',
      definitions: settingEnterpriseUsageCapabilities,
      contracts: SETTING_ENTERPRISE_USAGE_AI_CONTRACTS,
    })
    expect(issues.some((issue: { code: string; path: string }) => issue.code === 'missing-property' && issue.path === '$.purpose')).toBe(true)

    const prepare = SETTING_ENTERPRISE_USAGE_AI_CONTRACTS['setting-enterprise-usage-apply-prepare']!
    expect(prepare.steps[0]?.mapping).toEqual({ draft: 'result.draft' })
    const brokenMapping = structuredClone(prepare)
    brokenMapping.steps[0]!.mapping = { draft: 'result.payload' }
    expect(brokenMapping.steps[0]?.mapping).not.toEqual(prepare.steps[0]?.mapping)
  })

  it('权限和网络错误向调用方抛出，空页只表示没有数据', async () => {
    const request = vi.fn(async () => { throw new Error('权限不足') }) as unknown as PortalRequest
    const cap = createSettingEnterpriseUsageCapability(request)
    await expect(cap.listQuota()).rejects.toThrow('权限不足')

    const emptyRequest = vi.fn(async () => ({ list: [], total: 0 })) as unknown as PortalRequest
    const emptyCap = createSettingEnterpriseUsageCapability(emptyRequest)
    await expect(emptyCap.listUsage()).resolves.toEqual({ list: [], total: 0 })
  })
})
