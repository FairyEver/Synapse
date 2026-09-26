import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AxiosResponse } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'
import {
  PERSONAL_USAGE_BUTTON_PERMISSIONS,
  PERSONAL_USAGE_MODULE_TYPE,
  PERSONAL_USAGE_PAGE_PATH,
  PERSONAL_USAGE_PERMISSION,
  PERSONAL_USAGE_PATHS,
  modelUsageCapabilities,
  createModelUsageCapability,
  preparePersonalApply,
} from '../src/capabilities/model-usage.js'
import { MODEL_USAGE_CONTRACTS } from '../src/catalog/contracts-model-usage.js'

const portalRoot = '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const javaRoot = '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href

type Call = PortalRequestConfig

function makeCapability () {
  const calls: Call[] = []
  const request = vi.fn(async <T,>(config: PortalRequestConfig): Promise<T> => {
    calls.push(config)
    if (config.url === PERSONAL_USAGE_PATHS.usageTrend) throw new Error('trend down')
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
    if (config.url === PERSONAL_USAGE_PATHS.functionModuleList) return ['智能助手', '报表分析'] as T
    if (config.url === PERSONAL_USAGE_PATHS.applyPage) return { list: [{ id: 1, status: 0 }], total: 1 } as T
    if (config.url === PERSONAL_USAGE_PATHS.usagePage) return { list: [{ id: 8, modelName: '模型A' }], total: 1 } as T
    if (config.url === PERSONAL_USAGE_PATHS.quotaPage) return { list: [{ modelId: 7, modelName: '模型A' }], total: 1 } as T
    if (config.url === PERSONAL_USAGE_PATHS.modelDetail) return { id: 7, modelName: '模型A' } as T
    if (config.url === PERSONAL_USAGE_PATHS.usageDetail) return { id: 8, callStatus: 1 } as T
    return { cycleTotalQuota: 10, cycleUsedQuota: 2, cycleRemainingQuota: 8, currentCycleAvailableQuota: 8 } as T
  })
  return { calls, request: request as unknown as PortalRequest, cap: createModelUsageCapability(request as unknown as PortalRequest) }
}

describe('个人用量：Portal页面、Java权限与SDK范围逐页对齐', () => {
  it('菜单和页面入口属于保留portal/个人用量，不是独立生产模块', () => {
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/index.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/list.vue'), 'utf8')
    expect(menu).toContain("path: '/dashboard/model-usage/list'")
    expect(menu).toContain("permission: '/dashboard/model-usage'")
    expect(page).toContain('个人用量')
    expect(page).toContain('statisticsDimension')
    expect(page).not.toContain('/dashboard/production')
    expect(PERSONAL_USAGE_PAGE_PATH).toBe('/dashboard/model-usage/list')
    expect(PERSONAL_USAGE_PERMISSION).toBe('/dashboard/model-usage')
    expect(PERSONAL_USAGE_MODULE_TYPE).toBeNull()
  })

  it('页面按钮权限、后端权限与已失效端点均锁定', () => {
    const content = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/components/ModelUsageContent.vue'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/list.vue'), 'utf8')
    const quota = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/components/QuotaTab.vue'), 'utf8')
    const usage = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/components/UsageTab.vue'), 'utf8')
    const api = readFileSync(join(portalRoot, 'app/portal/views/dashboard/common/model-usage/api.js'), 'utf8')
    const javaTokenRoot = 'erp-module-ai/erp-module-ai-biz/src/main/java/com/wdbc/erp/module/ai/controller/admin/token'
    const quotaController = readFileSync(join(javaRoot, `${javaTokenRoot}/AiTokenQuotaUsageController.java`), 'utf8')
    const usageController = readFileSync(join(javaRoot, `${javaTokenRoot}/AiTokenUsageController.java`), 'utf8')
    const applyController = readFileSync(join(javaRoot, `${javaTokenRoot}/AiTokenQuotaApplyController.java`), 'utf8')
    const saveVo = readFileSync(join(javaRoot, `${javaTokenRoot}/vo/AiTokenQuotaApplySaveReqVO.java`), 'utf8')

    expect(page).toContain('ai-token:usage:query')
    expect(content).toContain('ai-token:apply:query')
    expect(usage).toContain('exportUsageData')
    expect(api).toContain('/ai-token/usage/export')
    expect(api).toContain('/ai-token/apply/create')
    expect(api).toContain('/ai-token/apply/page')
    expect(api).toContain('daily-progress')
    expect(PERSONAL_USAGE_PATHS).not.toHaveProperty('dailyProgress')
    expect(quotaController).toContain("ai-token:usage:query")
    expect(usageController).toContain("ai-token:usage:query")
    expect(applyController).toContain('@PermitAll')
    expect(applyController).toContain("ai-token:apply:query")
    expect(saveVo).toContain('@NotNull')
    expect(saveVo).toContain('@Positive')
    expect(saveVo).toContain('expectedMonthlyQuota')
    expect(PERSONAL_USAGE_BUTTON_PERMISSIONS).toEqual({ query: 'ai-token:usage:query', applyQuery: 'ai-token:apply:query' })
  })

  it('能力定义全部固定页面上下文，只有提交申请是写能力', () => {
    expect(modelUsageCapabilities).toHaveLength(12)
    expect(new Set(modelUsageCapabilities.map(item => item.id)).size).toBe(12)
    for (const item of modelUsageCapabilities) {
      expect(item.pagePath, item.id).toBe(PERSONAL_USAGE_PAGE_PATH)
      expect(item.permission, item.id).toBe(PERSONAL_USAGE_PERMISSION)
      expect(item.moduleType, item.id).toBeNull()
    }
    expect(modelUsageCapabilities.filter(item => item.write).map(item => item.id)).toEqual(['personal-usage-apply-submit'])
  })

  it('额度列表和汇总严格固定个人维度、页面默认周期和分页', async () => {
    const { calls, cap } = makeCapability()
    await cap.listQuota({ modelName: '', usageStatus: 0 })
    expect(calls[0]?.params).toEqual({ quotaCycle: 3, statisticsDimension: 1, usageStatus: 0, pageNo: 1, pageSize: 20 })
    await cap.getQuotaSummary({ pageNo: 9, pageSize: 99 })
    expect(calls[1]?.params).toEqual({ quotaCycle: 3, statisticsDimension: 1 })
  })

  it('用量列表补齐日期闭区间；分析按页面上下文决定是否请求三张分解图', async () => {
    const { calls, cap } = makeCapability()
    await cap.listUsage({ dateRange: ['2026-09-01', '2026-09-07'], modelId: 7, functionModule: '' })
    expect(calls[0]?.params).toEqual({
      quotaCycle: 2,
      timeRangeType: 2,
      statisticsDimension: 1,
      startTime: '2026-09-01 00:00:00',
      endTime: '2026-09-07 23:59:59',
      modelId: 7,
      pageNo: 1,
      pageSize: 20,
    })
    const analytics = await cap.usageAnalytics({ dateRange: ['2026-09-01', '2026-09-07'] })
    expect(calls.slice(1).map(item => item.url)).toEqual([
      PERSONAL_USAGE_PATHS.usageSummary,
      PERSONAL_USAGE_PATHS.usageTrend,
      PERSONAL_USAGE_PATHS.usageModelRatio,
      PERSONAL_USAGE_PATHS.usageModuleRanking,
    ])
    expect(analytics.summary).toEqual({ cycleTotalQuota: 10, cycleUsedQuota: 2, cycleRemainingQuota: 8, currentCycleAvailableQuota: 8 })
    expect(analytics.trend).toBeNull()
    expect(analytics.errors).toEqual({ trend: 'trend down' })

    const before = calls.length
    await cap.usageAnalytics({ modelId: 7 }, { includeBreakdowns: false })
    expect(calls.slice(before).map(item => item.url)).toEqual([PERSONAL_USAGE_PATHS.usageSummary])
  })

  it('功能模块只请求一次并本地筛选；详情和导出不混用ID/分页', async () => {
    const { calls, cap } = makeCapability()
    await expect(cap.listFunctionModules({ keyword: '报表' })).resolves.toEqual(['报表分析'])
    await cap.getUsageDetail(8)
    const file = await cap.exportUsage({ modelId: 7 })
    expect(calls[0]).toMatchObject({ url: PERSONAL_USAGE_PATHS.functionModuleList, method: 'get' })
    expect(calls[0]?.params).toBeUndefined()
    expect(calls[1]).toMatchObject({ url: PERSONAL_USAGE_PATHS.usageDetail, method: 'get', params: { id: 8 } })
    expect(calls[2]).toMatchObject({ url: PERSONAL_USAGE_PATHS.usageExport, method: 'get', responseType: 'arraybuffer' })
    expect(calls[2]?.params).toEqual({ quotaCycle: 2, timeRangeType: 2, statisticsDimension: 1, modelId: 7 })
    expect(file).toMatchObject({ fileName: '模型用量明细.xls', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
  })

  it('申请表单规则、body字段映射与取消语义逐项对齐', async () => {
    expect(() => preparePersonalApply({ modelId: 7, reason: 'x' })).toThrow('至少填写一个')
    expect(() => preparePersonalApply({ modelId: 7, expectedMaxToken: -1, reason: 'x' })).toThrow('整数')
    expect(() => preparePersonalApply({ modelId: 7, expectedMaxToken: 100, reason: 'x'.repeat(201) })).toThrow('200')
    const prepared = preparePersonalApply({ modelId: 7, modelName: '不能提交', monthlyQuota: 10, expectedMaxToken: 100, reason: '需要更高上限' })
    expect(prepared.payload).toEqual({ modelId: 7, currentMonthlyQuota: 10, expectedMaxToken: 100, statisticsDimension: 1, reason: '需要更高上限' })
    expect(prepared.payload).not.toHaveProperty('modelName')
    expect(prepared.warnings).toHaveLength(1)

    const { calls, cap } = makeCapability()
    await expect(cap.submitApply({ modelId: 7, expectedMonthlyQuota: 200, reason: '申请' })).resolves.toBe(902)
    expect(calls.at(-1)).toMatchObject({ url: PERSONAL_USAGE_PATHS.applyCreate, method: 'post', data: { modelId: 7, expectedMonthlyQuota: 200, statisticsDimension: 1, reason: '申请' } })
    expect(cap.cancelApply()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(1)
  })

  it('申请记录不补日期时分秒，且完整AI契约能被反证测试打红', async () => {
    const { calls, cap } = makeCapability()
    await cap.listApplyRecords({ modelId: 7, status: 0, dateRange: ['2026-09-01', '2026-09-30'] })
    expect(calls[0]?.params).toEqual({ modelId: 7, status: 0, statisticsDimension: 1, startDate: '2026-09-01', endDate: '2026-09-30', pageNo: 1, pageSize: 20 })
    const { validateAiContract, validateAiContracts } = await import(validatorUrl)
    const structural = validateAiContracts(MODEL_USAGE_CONTRACTS, { profile: 'structural', definitions: modelUsageCapabilities, contracts: MODEL_USAGE_CONTRACTS })
    expect(structural).toEqual([])
    const broken = structuredClone(MODEL_USAGE_CONTRACTS['personal-usage-quota-list']!)
    delete (broken as { purpose?: string }).purpose
    const issues = validateAiContract('personal-usage-quota-list', broken, { profile: 'structural', definitions: modelUsageCapabilities, contracts: MODEL_USAGE_CONTRACTS })
    expect(issues.some((issue: { code: string; path: string }) => issue.code === 'missing-property' && issue.path === '$.purpose')).toBe(true)
  })
})
