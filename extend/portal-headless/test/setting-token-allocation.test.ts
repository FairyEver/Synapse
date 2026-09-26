import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  ALLOCATION_METHOD_AVERAGE,
  ALLOCATION_METHOD_NONE,
  ALLOCATION_METHOD_SPECIFIED,
  APPLY_STATUS_HANDLED,
  APPLY_STATUS_IGNORED,
  APPLY_STATUS_REJECTED,
  OVER_LIMIT_STRATEGY_INHERIT,
  OVER_LIMIT_STRATEGY_FORBID,
  createSettingTokenAllocationCapability,
  SETTING_TOKEN_ALLOCATION_BUTTON_PERMISSIONS,
  SETTING_TOKEN_ALLOCATION_METHODS,
  SETTING_TOKEN_ALLOCATION_MODULE_TYPE,
  SETTING_TOKEN_ALLOCATION_PAGE_PATH,
  SETTING_TOKEN_ALLOCATION_PATHS,
  SETTING_TOKEN_ALLOCATION_PERMISSION,
  settingTokenAllocationCapabilities,
} from '../src/capabilities/setting-token-allocation.js'
import {
  SETTING_TOKEN_ALLOCATION_AI_CONTRACTS as contracts,
  SETTING_TOKEN_ALLOCATION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-setting-token-allocation.js'

type RequestConfig = Parameters<PortalRequest>[0]

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingTokenAllocationCapability(request), calls }
}

const start = '2026-09-01 00:00:00'
const end = '2026-09-30 23:59:59'
const modelPage = { list: [{ modelId: 11, modelName: '模型A' }], total: 1 }
const overview = {
  tenantTotalQuota: 100000,
  tenantUserCount: 2,
  averageQuota: 50000,
  adjustedUserCount: 0,
  unadjustedUserCount: 2,
  allocatedQuota: 100000,
  remainingQuota: 0,
  exceeded: false,
  allocationMethod: ALLOCATION_METHOD_AVERAGE,
  allocationMethodName: '平均分配',
  overLimitStrategy: OVER_LIMIT_STRATEGY_FORBID,
  overLimitStrategyName: '禁止',
  startTime: start,
  endTime: end,
  reason: '测试',
}

describe('Portal 系统设置 → 用量分配页面能力', () => {
  it('逐页核对菜单、路由、实例、module-type、按钮权限和实际端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/common/setting/token-allocation/list.vue')
    const api = read(portalRoot, 'app/portal/views/dashboard/common/setting/token-allocation/api.js')
    const utils = read(portalRoot, 'app/portal/views/dashboard/common/setting/token-allocation/utils.js')
    const components = [
      'components/AllocationSettings.vue',
      'components/UserAllocationTable.vue',
      'components/UserAllocationModal.vue',
      'components/ApplyRecordModal.vue',
    ].map(path => read(portalRoot, `app/portal/views/dashboard/common/setting/token-allocation/${path}`)).join('\n')

    expect(menu).toContain(`path: '${SETTING_TOKEN_ALLOCATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_TOKEN_ALLOCATION_PERMISSION}'`)
    expect(route).toContain(`permission: ${SETTING_TOKEN_ALLOCATION_PERMISSION}`)
    expect(api).toContain("app/portal/utils/http/platform.js")
    for (const path of Object.values(SETTING_TOKEN_ALLOCATION_PATHS)) expect(api).toContain(path)
    for (const permission of Object.values(SETTING_TOKEN_ALLOCATION_BUTTON_PERMISSIONS)) expect(route).toContain(permission)
    for (const fragment of [
      'buildAveragePayload', 'buildPreviewPayload', 'buildImportFormData',
      'ALLOCATION_METHOD_NONE', 'ALLOCATION_METHOD_AVERAGE', 'ALLOCATION_METHOD_SPECIFIED',
      'APPLY_STATUS_IGNORED', 'APPLY_STATUS_FILLED', 'APPLY_STATUS_HANDLED',
      'OVER_LIMIT_STRATEGY_INHERIT',
    ]) expect(utils).toContain(fragment)
    // 子组件不自己裁决按钮权限；页面把 canSave/canClear/canQueryApply/canHandle 作为 props 注入。
    expect(components).toContain('canSave')
    expect(components).toContain('canClear')
    expect(components).toContain('canHandle')

    expect(resolveModuleType(SETTING_TOKEN_ALLOCATION_PAGE_PATH).moduleType).toBeNull()
    expect(settingTokenAllocationCapabilities).toHaveLength(Object.keys(SETTING_TOKEN_ALLOCATION_METHODS).length)
    expect(settingTokenAllocationCapabilities.every(item => item.pagePath === SETTING_TOKEN_ALLOCATION_PAGE_PATH && item.permission === SETTING_TOKEN_ALLOCATION_PERMISSION && item.moduleType === SETTING_TOKEN_ALLOCATION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页核对 Java 端点、权限注解、VO 校验和导入列', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const aiBase = join(javaRoot, 'erp-module-ai/erp-module-ai-biz/src/main/java/com/wdbc/erp/module/ai/controller/admin/token')
    const controller = read(aiBase, 'AiTokenAllocationController.java')
    const apply = read(aiBase, 'AiTokenQuotaApplyController.java')
    const usage = read(aiBase, 'AiTokenQuotaUsageController.java')
    const batch = read(aiBase, 'vo/AiTokenAllocationBatchReqVO.java')
    const save = read(aiBase, 'vo/AiTokenAllocationSaveReqVO.java')
    const preview = read(aiBase, 'vo/AiTokenAllocationPreviewReqVO.java')
    const importResponse = read(aiBase, 'vo/AiTokenAllocationImportRespVO.java')
    const service = read(javaRoot, 'erp-module-ai/erp-module-ai-biz/src/main/java/com/wdbc/erp/module/ai/service/token/AiTokenManagementServiceImpl.java')

    for (const fragment of [
      '@RequestMapping("/ai-token/allocation")', '@PostMapping("/save-user")', '@PostMapping("/save-average")',
      '@GetMapping("/import-template")', '@PostMapping("/import")', '@GetMapping("/clear")', '@GetMapping("/clear-by-model")',
      '@GetMapping("/effective-page")', '@GetMapping("/overview")', '@PostMapping("/preview")',
      "ai-token:allocation:save", "ai-token:allocation:clear", 'convertAllocationRows', 'setAllocatedQuota',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ["ai-token:apply:query", "ai-token:apply:handle", '@GetMapping("/pending-count")', '@PostMapping("/handle")']) expect(apply).toContain(fragment)
    expect(usage).toContain("ai-token:usage:query")
    for (const fragment of ['@NotNull', '@Positive', 'private Long averageQuota', 'private Integer overLimitStrategy', 'private LocalDateTime startTime', 'List<AiTokenAllocationAdjustReqVO> adjustments']) expect(batch).toContain(fragment)
    for (const fragment of ['@NotBlank', 'private String userPhone', 'private Long allocatedQuota', 'private LocalDateTime startTime']) expect(save).toContain(fragment)
    for (const fragment of ['AiTokenAllocationMethodEnum', 'averageQuota', 'private Integer allocationMethod']) expect(preview).toContain(fragment)
    for (const fragment of ['totalCount', 'successCount', 'failureCount', 'failureMessages']) expect(importResponse).toContain(fragment)
    for (const fragment of ['validateTime', 'validateAllocationQuota', 'validateAllocationAdjustments', 'deleteUserAllocationsByModelId', 'failureMessages', '手机号重复']) expect(service).toContain(fragment)

    // Counter-evidence: the Java controller currently has no explicit permission annotation on import/template/overview/preview.
    const importBlock = controller.slice(controller.indexOf('@PostMapping("/import")'), controller.indexOf('@GetMapping("/clear")'))
    expect(importBlock).not.toContain('@PreAuthorize')
    const previewBlock = controller.slice(controller.indexOf('@PostMapping("/preview")'))
    expect(previewBlock).not.toContain('@PreAuthorize')
  })

  it('复刻模型候选、概览、有效分配、申请查询和关键词用户搜索的请求形状', async () => {
    const f = fixture([modelPage, overview, { list: [], total: 0 }, { list: [], total: 0 }, 3, { list: [], total: 0 }])
    await expect(f.api.listModels()).resolves.toEqual(modelPage)
    await expect(f.api.overview({ modelId: 11, allocationMethod: '' })).resolves.toEqual(overview)
    await expect(f.api.listEffective({ modelId: 11 })).resolves.toEqual({ list: [], total: 0 })
    await expect(f.api.listApply({ modelId: 11, status: APPLY_STATUS_IGNORED, dateRange: [start, end] })).resolves.toEqual({ list: [], total: 0 })
    await expect(f.api.pendingApplyCount({ modelId: 11 })).resolves.toBe(3)
    await expect(f.api.searchUsers({ keyword: '张', pageSize: 20 })).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls).toEqual([
      { url: SETTING_TOKEN_ALLOCATION_PATHS.modelPage, method: 'get', params: { pageNo: 1, pageSize: 100 } },
      { url: SETTING_TOKEN_ALLOCATION_PATHS.overview, method: 'get', params: { modelId: 11, allocationMethod: undefined } },
      { url: SETTING_TOKEN_ALLOCATION_PATHS.effectivePage, method: 'get', params: { modelId: 11, userName: '', allocationMethod: undefined, pageNo: 1, pageSize: 20 } },
      { url: SETTING_TOKEN_ALLOCATION_PATHS.applyPage, method: 'get', params: { modelId: 11, userName: '', status: APPLY_STATUS_IGNORED, startDate: start, endDate: end, pageNo: 1, pageSize: 20 } },
      { url: SETTING_TOKEN_ALLOCATION_PATHS.pendingCount, method: 'get', params: { modelId: 11 } },
      { url: SETTING_TOKEN_ALLOCATION_PATHS.userPage, method: 'get', params: { name: '张', pageNo: 1, pageSize: 20 } },
    ])
    await expect(f.api.searchUsers({ keyword: ' ' })).rejects.toThrow('keyword')
    expect(f.calls).toHaveLength(6)
  })

  it('锁定平均分配、预览和用户分配表单规则，并覆盖反证', async () => {
    const f = fixture([true, overview, '9001'])
    const average = f.api.prepareSaveAverage({
      modelId: 11,
      formState: { averageQuota: 50000, overLimitStrategy: 1, startTime: start, endTime: end, reason: '团队额度' },
      adjustments: [],
    })
    expect(average.payload).toEqual({ modelId: 11, averageQuota: 50000, overLimitStrategy: 1, startTime: start, endTime: end, reason: '团队额度', adjustments: [] })
    await expect(f.api.saveAverage({ draft: average.draft })).resolves.toBe(true)

    const preview = f.api.preparePreview({ modelId: 11, allocationMethod: ALLOCATION_METHOD_NONE, formState: {} })
    expect(preview.payload).toMatchObject({ modelId: 11, allocationMethod: 0, reason: '', adjustments: [] })
    const inheritedPreview = f.api.preparePreview({ modelId: 11, allocationMethod: ALLOCATION_METHOD_AVERAGE, formState: { averageQuota: 100, overLimitStrategy: OVER_LIMIT_STRATEGY_INHERIT } })
    expect(inheritedPreview.payload.overLimitStrategy).toBe(OVER_LIMIT_STRATEGY_INHERIT)
    await expect(f.api.preview({ draft: { ...preview.draft, allocationMethod: ALLOCATION_METHOD_AVERAGE, averageQuota: 100 } })).resolves.toEqual(overview)

    const user = f.api.prepareSaveUser({
      modelId: 11,
      formState: { id: 21, userId: 31, userPhone: '13800138000', userName: '张三', allocatedQuota: '1000', overLimitStrategy: 2, startTime: start, reason: '' },
    })
    expect(user.payload).toEqual({ id: 21, modelId: 11, userId: 31, userPhone: '13800138000', userName: '张三', allocatedQuota: '1000', overLimitStrategy: 2, startTime: start, endTime: undefined, reason: '' })
    await expect(f.api.saveUser({ draft: user.draft })).resolves.toBe('9001')

    expect(() => f.api.prepareSaveAverage({ modelId: 11, formState: { averageQuota: 0, overLimitStrategy: 1, startTime: start } })).toThrow('averageQuota')
    expect(() => f.api.prepareSaveAverage({ modelId: 11, formState: { averageQuota: 1, overLimitStrategy: 0, startTime: start } })).toThrow('继承全局')
    expect(() => f.api.prepareSaveAverage({ modelId: 11, formState: { averageQuota: 1, overLimitStrategy: 1, startTime: end, endTime: start } })).toThrow('endTime')
    expect(() => f.api.preparePreview({ modelId: 11, allocationMethod: ALLOCATION_METHOD_AVERAGE, formState: {} })).toThrow('averageQuota')
    expect(() => f.api.preparePreview({ modelId: 11, allocationMethod: ALLOCATION_METHOD_SPECIFIED, formState: {}, adjustments: [{}] as never })).toThrow('空数组')
    expect(() => f.api.prepareSaveUser({ modelId: 11, formState: { userId: 31, userPhone: '', allocatedQuota: 1, overLimitStrategy: 1, startTime: start } })).toThrow('userPhone')
    expect(() => f.api.prepareSaveUser({ modelId: 11, formState: { userId: 31, userPhone: '1', allocatedQuota: 1, overLimitStrategy: 1, startTime: start, reason: 'x'.repeat(501) } })).toThrow('500')
    expect(f.calls).toHaveLength(3)
  })

  it('锁定导入、文件下载、清空和申请处理的请求/权限状态边界', async () => {
    const file = { fileName: '用户额度.xlsx', base64: 'AQID' }
    const f = fixture([
      { totalCount: 2, successCount: 2, failureCount: 0, failureMessages: [] },
      { data: Uint8Array.from([1, 2, 3]).buffer, headers: { 'content-disposition': "attachment; filename*=UTF-8''用户额度分配导入模板.xls", 'content-type': 'application/vnd.ms-excel' } },
      true, true, true,
    ])
    const preparation = f.api.prepareImport({ modelId: 11, overLimitStrategy: 1, startTime: start, reason: '', file })
    expect(preparation.file).toEqual({ fileName: '用户额度.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3 })
    await expect(f.api.importAllocation({ draft: preparation.draft, file })).resolves.toMatchObject({ totalCount: 2, successCount: 2, failureCount: 0, failureMessages: [] })
    const data = f.calls[0]?.data as FormData
    const entries = [...(data as unknown as { entries: () => IterableIterator<[string, unknown]> }).entries()]
    expect(Object.fromEntries(entries.filter(([, value]) => typeof value === 'string'))).toEqual({ modelId: '11', overLimitStrategy: '1', startTime: start })
    const uploaded = entries.find(([key]) => key === 'file')?.[1] as unknown as { name?: string }
    expect(uploaded.name).toBe('用户额度.xlsx')

    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '用户额度分配导入模板.xls', base64: 'AQID', byteLength: 3 })
    await expect(f.api.clearUser({ draft: { id: 21 } })).resolves.toBe(true)
    await expect(f.api.clearAll({ draft: { modelId: 11 } })).resolves.toBe(true)
    expect(f.calls.slice(1).map(call => ({ url: call.url, method: call.method, params: call.params }))).toEqual([
      { url: SETTING_TOKEN_ALLOCATION_PATHS.importTemplate, method: 'get', params: undefined },
      { url: SETTING_TOKEN_ALLOCATION_PATHS.clear, method: 'get', params: { id: 21 } },
      { url: SETTING_TOKEN_ALLOCATION_PATHS.clearByModel, method: 'get', params: { modelId: 11 } },
    ])

    const handled = fixture([true, true])
    await expect(handled.api.handleApply({ draft: { id: 77, status: APPLY_STATUS_REJECTED, rejectReason: '额度不足' } })).resolves.toBe(true)
    await expect(handled.api.handleApply({ draft: { id: 77, status: APPLY_STATUS_HANDLED } })).resolves.toBe(true)
    expect(handled.calls.map(call => call.data)).toEqual([
      { id: 77, status: APPLY_STATUS_REJECTED, rejectReason: '额度不足' },
      { id: 77, status: APPLY_STATUS_HANDLED },
    ])

    await expect(fixture([true]).api.handleApply({ id: 77, status: APPLY_STATUS_IGNORED as never })).rejects.toThrow('只能是3')
    await expect(fixture([{ totalCount: 1, successCount: 0, failureCount: 1, failureMessages: ['第2行手机号不存在'] }]).api.importAllocation({ ...({ modelId: 11, overLimitStrategy: 1, startTime: start, file }) })).resolves.toMatchObject({ failureCount: 1 })
    await expect(fixture([{ totalCount: 0, successCount: 0, failureCount: 0, failureMessages: [] }]).api.importAllocation({ ...({ modelId: 11, overLimitStrategy: OVER_LIMIT_STRATEGY_INHERIT, startTime: start, file }) })).resolves.toMatchObject({ failureCount: 0 })
    expect(() => fixture([]).api.prepareImport({ modelId: 11, overLimitStrategy: 1, startTime: start, file: { fileName: 'bad.csv', base64: 'AQID' } })).toThrow('扩展名')
  })

  it('逐字段锁定返回契约、错误传播和AI contract反证', async () => {
    const f = fixture([overview, { list: [{ id: 21, userId: 31, userPhone: '13800138000', userName: '张三', allocatedQuota: 1000 }], total: 1 }, { list: [{ id: 77, userName: '张三', expectedMonthlyQuota: 1000, status: 0, statusName: '待处理' }], total: 1 }, { list: [{ id: 31, mobile: '13800138000', realName: '张三' }], total: 1 }])
    await expect(f.api.overview({ modelId: 11 })).resolves.toMatchObject({ tenantTotalQuota: 100000, remainingQuota: 0, allocationMethod: 1 })
    await expect(f.api.listEffective({ modelId: 11 })).resolves.toMatchObject({ list: [expect.objectContaining({ userPhone: '13800138000', allocatedQuota: 1000 })] })
    await expect(f.api.listApply({ modelId: 11 })).resolves.toMatchObject({ list: [expect.objectContaining({ expectedMonthlyQuota: 1000, status: 0 })] })
    await expect(f.api.searchUsers({ keyword: '张' })).resolves.toMatchObject({ list: [expect.objectContaining({ id: 31, mobile: '13800138000', realName: '张三' })] })
    await expect(fixture([new Error('权限不足')]).api.overview({ modelId: 11 })).rejects.toThrow('权限不足')
    await expect(fixture([{ list: [], total: -1 }]).api.listEffective({ modelId: 11 })).rejects.toThrow('total')

    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_TOKEN_ALLOCATION_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual([...new Set(Object.values(SETTING_TOKEN_ALLOCATION_METHODS).map(method => `settingTokenAllocation.${method}`))].sort())
    expect(contracts['setting-token-allocation-import']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['totalCount', 'failureMessages']))
    expect(contracts['setting-token-allocation-apply-list']?.boundaries.join(' ')).toContain('申请筛选展示0/1/2/3/4')
    expect(contracts['setting-token-allocation-user-search']?.consume.join(' ')).toContain('keyword必须非空')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: settingTokenAllocationCapabilities, contracts })).toEqual([])

    const broken = structuredClone(contracts) as Record<string, { purpose: string }>
    broken['setting-token-allocation-overview']!.purpose = ''
    expect(validateAiContracts(broken, { definitions: settingTokenAllocationCapabilities, contracts: broken }).map((issue: unknown) => (issue as { code: string }).code)).toContain('empty-text')
  })
})
