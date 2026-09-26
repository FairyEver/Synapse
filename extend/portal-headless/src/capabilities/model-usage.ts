import type { AxiosResponse } from 'axios'

import { AI_MODEL_PATHS, AI_TOKEN_PATHS, CALL_STATUS, DEFAULT_PAGE_SIZE, LIMIT_TYPE, QUOTA_CYCLE, STATISTICS_DIMENSION, TIME_RANGE, USAGE_STATUS, USER_BELONG, buildUsageRecordQuery, buildUsageSummaryQuery, buildQuotaUsageQuery, cleanQuery } from './ai-model.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'
import type { PortalRequest } from '../session/types.js'

/** Portal 保留范围中的「个人用量」页面；它不是独立的生产模块。 */
export const PERSONAL_USAGE_PAGE_PATH = '/dashboard/model-usage/list'
export const PERSONAL_USAGE_PERMISSION = '/dashboard/model-usage'
export const PERSONAL_USAGE_MODULE_TYPE = null

export const PERSONAL_USAGE_BUTTON_PERMISSIONS = {
  query: 'ai-token:usage:query',
  applyQuery: 'ai-token:apply:query',
} as const

export const PERSONAL_USAGE_PATHS = {
  quotaPage: AI_TOKEN_PATHS.quotaUsagePage,
  quotaSummary: AI_TOKEN_PATHS.quotaUsageSummary,
  usagePage: AI_TOKEN_PATHS.usagePage,
  usageSummary: AI_TOKEN_PATHS.usageSummary,
  usageTrend: AI_TOKEN_PATHS.usageTrend,
  usageModelRatio: AI_TOKEN_PATHS.usageModelRatio,
  usageModuleRanking: AI_TOKEN_PATHS.usageModuleRanking,
  usageDetail: AI_TOKEN_PATHS.usageDetail,
  usageExport: '/admin-api/ai-token/usage/export',
  functionModuleList: AI_TOKEN_PATHS.functionModuleList,
  modelDetail: AI_MODEL_PATHS.detail,
  applyCreate: AI_TOKEN_PATHS.applyCreate,
  applyPage: AI_TOKEN_PATHS.applyPage,
} as const

export type PersonalQuotaQuery = {
  modelName?: string
  quotaCycle?: number
  usageStatus?: number
  pageNo?: number
  pageSize?: number
}

export type PersonalUsageQuery = {
  quotaCycle?: number
  timeRangeType?: number
  /** 页面日期选择器输出的 [开始日, 结束日]；不带时间的日期由 SDK 补齐。 */
  dateRange?: [string?, string?] | null
  requestId?: string
  modelId?: number | string
  tenantId?: number | string
  tenantName?: string
  userName?: string
  userBelong?: number
  memberLevel?: number
  functionModule?: string
  callStatus?: number
  limitType?: string
  quotaDeducted?: boolean
  pageNo?: number
  pageSize?: number
}

export type PersonalApplyDraft = {
  modelId: number | string
  modelName?: string | null
  monthlyQuota?: number | string | null
  expectedMonthlyQuota?: number | string | null
  maxTokenPerRequest?: number | string | null
  expectedMaxToken?: number | string | null
  statisticsDimension?: number
  reason?: string | null
}

export type PersonalApplyPreparation = {
  draft: PersonalApplyDraft
  payload: Record<string, unknown>
  warnings: string[]
}

export type PersonalUsageFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type PersonalFunctionModule = string | Record<string, unknown>
export type PersonalUsageRow = Record<string, unknown>
export type PersonalQuotaRow = Record<string, unknown>
export type PersonalApplyRow = Record<string, unknown>

const QUOTA_PARAMS: ParamSpec[] = [
  { name: 'modelName', kind: 'text', required: false, description: '模型名称，页面只提供模型筛选' },
  {
    name: 'quotaCycle',
    kind: 'enum',
    required: false,
    description: '额度周期；默认月度 3',
    options: [
      { label: '日', value: QUOTA_CYCLE.day },
      { label: '周', value: QUOTA_CYCLE.week },
      { label: '月', value: QUOTA_CYCLE.month },
    ],
  },
  {
    name: 'usageStatus',
    kind: 'enum',
    required: false,
    description: '额度使用状态；0 未分配、1 正常、2 预警、3 已用尽',
    options: [
      { label: '未分配', value: USAGE_STATUS.unallocated },
      { label: '正常', value: USAGE_STATUS.normal },
      { label: '预警', value: USAGE_STATUS.warning },
      { label: '已用尽', value: USAGE_STATUS.exhausted },
    ],
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
]

const USAGE_PARAMS: ParamSpec[] = [
  {
    name: 'quotaCycle',
    kind: 'enum',
    required: false,
    description: '统计所属额度周期；默认周 2',
    options: [
      { label: '日', value: QUOTA_CYCLE.day },
      { label: '周', value: QUOTA_CYCLE.week },
      { label: '月', value: QUOTA_CYCLE.month },
    ],
  },
  {
    name: 'timeRangeType',
    kind: 'enum',
    required: false,
    description: '时间范围；1 今天、2 本月、3 最近7天、4 最近30天、5 自定义',
    options: [
      { label: '今天', value: TIME_RANGE.today },
      { label: '本月', value: TIME_RANGE.thisMonth },
      { label: '最近7天', value: TIME_RANGE.last7Days },
      { label: '最近30天', value: TIME_RANGE.last30Days },
      { label: '自定义', value: TIME_RANGE.custom },
    ],
  },
  { name: 'dateRange', kind: 'date', required: false, description: '自定义日期范围 [YYYY-MM-DD, YYYY-MM-DD]' },
  { name: 'requestId', kind: 'text', required: false, description: '调用请求ID；个人根页面不显示，但后端支持' },
  { name: 'modelId', kind: 'number', required: false, description: '模型ID；从模型列表进入用量明细时使用' },
  { name: 'tenantId', kind: 'number', required: false, description: '租户ID；仅模型上下文/扩展调用时使用' },
  { name: 'tenantName', kind: 'text', required: false, description: '租户名称；模型上下文/扩展调用时使用' },
  { name: 'userName', kind: 'text', required: false, description: '用户名；模型上下文/扩展调用时使用' },
  {
    name: 'userBelong',
    kind: 'enum',
    required: false,
    description: '用户归属；1 个人、2 企业',
    options: [
      { label: '个人', value: USER_BELONG.personal },
      { label: '企业', value: USER_BELONG.enterprise },
    ],
  },
  { name: 'memberLevel', kind: 'number', required: false, description: '会员等级' },
  { name: 'functionModule', kind: 'text', required: false, description: '功能模块；候选值由 listFunctionModules 返回并在本地筛选' },
  {
    name: 'callStatus',
    kind: 'enum',
    required: false,
    description: '调用状态；1 成功、2 限流、3 额度不足、4 失败',
    options: [
      { label: '成功', value: CALL_STATUS.success },
      { label: '限流', value: CALL_STATUS.limited },
      { label: '额度不足', value: CALL_STATUS.quotaNotEnough },
      { label: '失败', value: CALL_STATUS.failed },
    ],
  },
  {
    name: 'limitType',
    kind: 'enum',
    required: false,
    description: '限制类型；FLOW 流速、QUOTA 额度',
    options: [
      { label: '流速', value: LIMIT_TYPE.flow },
      { label: '额度', value: LIMIT_TYPE.quota },
    ],
  },
  { name: 'quotaDeducted', kind: 'boolean', required: false, description: '是否扣减额度' },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
]

const APPLY_PARAMS: ParamSpec[] = [
  { name: 'draft', kind: 'text', required: true, description: '申请额度提升表单草稿；包含 modelId、期望额度/最大Token和 reason' },
]

const APPLY_RECORD_PARAMS: ParamSpec[] = [
  { name: 'modelId', kind: 'number', required: false, description: '模型ID' },
  { name: 'status', kind: 'enum', required: false, description: '申请状态；页面筛选值按 Portal 原样传递', options: [{ label: '待处理', value: 0 }, { label: '忽略', value: 1 }, { label: '已填写', value: 2 }, { label: '驳回', value: 3 }] },
  { name: 'dateRange', kind: 'date', required: false, description: '申请日期 [YYYY-MM-DD, YYYY-MM-DD]；个人页面不补时分秒' },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
]

const PERSONAL_CAPABILITY = {
  pagePath: PERSONAL_USAGE_PAGE_PATH,
  moduleType: PERSONAL_USAGE_MODULE_TYPE,
  permission: PERSONAL_USAGE_PERMISSION,
} as const

export const modelUsageCapabilities: CapabilityDefinition[] = [
  { id: 'personal-usage-quota-list', title: '查询个人额度列表', ...PERSONAL_CAPABILITY, write: false, params: QUOTA_PARAMS },
  { id: 'personal-usage-quota-summary', title: '查询个人额度汇总', ...PERSONAL_CAPABILITY, write: false, params: QUOTA_PARAMS.filter(({ name }) => !['pageNo', 'pageSize'].includes(name)) },
  { id: 'personal-usage-usage-list', title: '查询个人用量明细', ...PERSONAL_CAPABILITY, write: false, params: USAGE_PARAMS },
  { id: 'personal-usage-usage-analytics', title: '查询个人用量分析', ...PERSONAL_CAPABILITY, write: false, params: [...USAGE_PARAMS, { name: 'includeBreakdowns', kind: 'boolean', required: false, description: '是否同时请求趋势、模型占比和功能模块排行；从模型上下文进入时传 false' }] },
  { id: 'personal-usage-usage-detail', title: '查询个人用量明细详情', ...PERSONAL_CAPABILITY, write: false, params: [{ name: 'id', kind: 'number', required: true, description: '用量记录ID' }] },
  { id: 'personal-usage-usage-export', title: '导出个人用量明细', ...PERSONAL_CAPABILITY, write: false, params: USAGE_PARAMS.filter(({ name }) => !['pageNo', 'pageSize'].includes(name)) },
  { id: 'personal-usage-function-module-list', title: '查询个人用量功能模块候选', ...PERSONAL_CAPABILITY, write: false, params: [{ name: 'keyword', kind: 'text', required: false, description: '本地筛选关键字；接口本身无参数且只请求一次' }] },
  { id: 'personal-usage-model-detail', title: '查询个人用量上下文模型', ...PERSONAL_CAPABILITY, write: false, params: [{ name: 'id', kind: 'number', required: true, description: '模型ID' }] },
  { id: 'personal-usage-apply-prepare', title: '准备个人额度提升申请', ...PERSONAL_CAPABILITY, write: false, params: APPLY_PARAMS },
  { id: 'personal-usage-apply-submit', title: '提交个人额度提升申请', ...PERSONAL_CAPABILITY, write: true, params: APPLY_PARAMS },
  { id: 'personal-usage-apply-record-list', title: '查询个人额度申请记录', ...PERSONAL_CAPABILITY, write: false, params: APPLY_RECORD_PARAMS },
  { id: 'personal-usage-apply-cancel', title: '取消未提交的个人额度申请草稿', ...PERSONAL_CAPABILITY, write: false, params: [] },
]

function requireId (value: unknown, label: string): number | string {
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(`${label}不能为空`)
  }
  return value as number | string
}

function pageOf<T extends Record<string, unknown>> (value: unknown): PageResult<T> {
  const page = (value ?? {}) as { list?: unknown; total?: unknown }
  return {
    list: Array.isArray(page.list) ? page.list as T[] : [],
    total: typeof page.total === 'number' && Number.isFinite(page.total) ? page.total : Number(page.total ?? 0) || 0,
  }
}

function quotaParams (query: PersonalQuotaQuery = {}): Record<string, unknown> {
  return buildQuotaUsageQuery({
    ...query,
    quotaCycle: query.quotaCycle ?? QUOTA_CYCLE.month,
    pageNo: query.pageNo ?? 1,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  }, STATISTICS_DIMENSION.personal)
}

function quotaSummaryParams (query: PersonalQuotaQuery = {}): Record<string, unknown> {
  const { pageNo: _pageNo, pageSize: _pageSize, ...rest } = query
  return buildQuotaUsageQuery({ ...rest, quotaCycle: rest.quotaCycle ?? QUOTA_CYCLE.month }, STATISTICS_DIMENSION.personal)
}

function usageParams (query: PersonalUsageQuery = {}, withPaging = true): Record<string, unknown> {
  const dateRange = query.dateRange ?? []
  const { dateRange: _dateRange, pageNo: _pageNo, pageSize: _pageSize, ...rest } = query
  const params = buildUsageRecordQuery({
    ...rest,
    startTime: dateRange[0],
    endTime: dateRange[1],
    quotaCycle: query.quotaCycle ?? QUOTA_CYCLE.week,
    timeRangeType: query.timeRangeType ?? TIME_RANGE.thisMonth,
    ...(withPaging ? { pageNo: query.pageNo ?? 1, pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE } : {}),
  }, STATISTICS_DIMENSION.personal)
  return params
}

function usageSummaryParams (query: PersonalUsageQuery = {}): Record<string, unknown> {
  const dateRange = query.dateRange ?? []
  const { dateRange: _dateRange, pageNo: _pageNo, pageSize: _pageSize, ...rest } = query
  return buildUsageSummaryQuery({
    ...rest,
    startTime: dateRange[0],
    endTime: dateRange[1],
    quotaCycle: query.quotaCycle ?? QUOTA_CYCLE.week,
    timeRangeType: query.timeRangeType ?? TIME_RANGE.thisMonth,
  }, STATISTICS_DIMENSION.personal)
}

function applyRecordParams (query: PersonalApplyQuery = {}): Record<string, unknown> {
  return cleanQuery({
    modelId: query.modelId,
    status: query.status,
    statisticsDimension: STATISTICS_DIMENSION.personal,
    startDate: query.dateRange?.[0],
    endDate: query.dateRange?.[1],
    pageNo: query.pageNo ?? 1,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  })
}

export type PersonalApplyQuery = {
  modelId?: number | string
  status?: number
  dateRange?: [string?, string?] | null
  pageNo?: number
  pageSize?: number
}

export function buildPersonalApplyPayload (draft: PersonalApplyDraft): Record<string, unknown> {
  return cleanQuery({
    modelId: draft.modelId,
    currentMonthlyQuota: draft.monthlyQuota,
    expectedMonthlyQuota: draft.expectedMonthlyQuota,
    currentMaxToken: draft.maxTokenPerRequest,
    expectedMaxToken: draft.expectedMaxToken,
    statisticsDimension: STATISTICS_DIMENSION.personal,
    reason: draft.reason,
  })
}

function present (value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

export function preparePersonalApply (draft: PersonalApplyDraft): PersonalApplyPreparation {
  requireId(draft?.modelId, 'modelId')
  const warnings: string[] = []
  if (!present(draft.expectedMonthlyQuota) && !present(draft.expectedMaxToken)) {
    throw new Error('expectedMonthlyQuota和expectedMaxToken至少填写一个')
  }
  if (typeof draft.reason !== 'string' || draft.reason.trim() === '') throw new Error('reason不能为空')
  if (draft.reason.length > 200) throw new Error('reason不能超过200个字符')
  for (const [name, value] of [['expectedMonthlyQuota', draft.expectedMonthlyQuota], ['expectedMaxToken', draft.expectedMaxToken] as const]) {
    if (!present(value)) continue
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue < 0) {
      throw new Error(`${name}必须是大于等于0的整数`)
    }
  }
  if (!present(draft.expectedMonthlyQuota) || Number(draft.expectedMonthlyQuota) <= 0) {
    warnings.push('Portal表单允许只填写最大Token或填写0，但Java接口对expectedMonthlyQuota声明了@NotNull @Positive；提交可能被后端拒绝。')
  }
  return { draft, payload: buildPersonalApplyPayload(draft), warnings }
}

function fileBytesOf (response: AxiosResponse<ArrayBuffer>): Uint8Array {
  const data: unknown = response?.data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('个人用量导出响应不是二进制文件')
}

function headerOf (response: AxiosResponse<ArrayBuffer>, name: string): string | undefined {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' ? value : undefined
}

function fileOf (response: AxiosResponse<ArrayBuffer>): PersonalUsageFile {
  const bytes = fileBytesOf(response)
  const disposition = headerOf(response, 'content-disposition')
  const encoded = disposition ? /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] : undefined
  let fileName = '模型用量明细.xls'
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else if (disposition) {
    fileName = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || fileName
  }
  return {
    fileName,
    contentType: headerOf(response, 'content-type') ?? null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

async function settleAll<K extends string> (
  entries: ReadonlyArray<readonly [K, () => Promise<unknown>]>,
): Promise<Record<K, unknown> & { errors: Record<string, string> }> {
  const errors: Record<string, string> = {}
  const values = await Promise.all(entries.map(async ([key, run]) => {
    try { return [key, await run()] as const } catch (error) {
      errors[key] = error instanceof Error ? error.message : String(error)
      return [key, null] as const
    }
  }))
  return { ...(Object.fromEntries(values) as Record<K, unknown>), errors }
}

export function createModelUsageCapability (request: PortalRequest) {
  return {
    async listQuota (query: PersonalQuotaQuery = {}): Promise<PageResult<PersonalQuotaRow>> {
      return pageOf<PersonalQuotaRow>(await request({ url: PERSONAL_USAGE_PATHS.quotaPage, method: 'get', params: quotaParams(query) }))
    },

    async getQuotaSummary (query: PersonalQuotaQuery = {}): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>({ url: PERSONAL_USAGE_PATHS.quotaSummary, method: 'get', params: quotaSummaryParams(query) })
    },

    async listUsage (query: PersonalUsageQuery = {}): Promise<PageResult<PersonalUsageRow>> {
      return pageOf<PersonalUsageRow>(await request({ url: PERSONAL_USAGE_PATHS.usagePage, method: 'get', params: usageParams(query) }))
    },

    async usageAnalytics (query: PersonalUsageQuery = {}, options: { includeBreakdowns?: boolean } = {}): Promise<{
      summary: unknown
      trend: unknown
      modelRatio: unknown
      moduleRanking: unknown
      errors: Record<string, string>
    }> {
      const params = usageSummaryParams(query)
      const entries: Array<readonly [string, () => Promise<unknown>]> = [
        ['summary', () => request({ url: PERSONAL_USAGE_PATHS.usageSummary, method: 'get', params })],
      ]
      if (options.includeBreakdowns !== false) {
        entries.push(
          ['trend', () => request({ url: PERSONAL_USAGE_PATHS.usageTrend, method: 'get', params })],
          ['modelRatio', () => request({ url: PERSONAL_USAGE_PATHS.usageModelRatio, method: 'get', params })],
          ['moduleRanking', () => request({ url: PERSONAL_USAGE_PATHS.usageModuleRanking, method: 'get', params })],
        )
      }
      const settled = await settleAll(entries)
      return {
        summary: settled.summary ?? null,
        trend: settled.trend ?? null,
        modelRatio: settled.modelRatio ?? null,
        moduleRanking: settled.moduleRanking ?? null,
        errors: settled.errors,
      }
    },

    async getUsageDetail (id: number | string): Promise<Record<string, unknown>> {
      requireId(id, '用量记录 id')
      return request({ url: PERSONAL_USAGE_PATHS.usageDetail, method: 'get', params: { id } })
    },

    async exportUsage (query: PersonalUsageQuery = {}): Promise<PersonalUsageFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: PERSONAL_USAGE_PATHS.usageExport, method: 'get', params: usageParams(query, false), responseType: 'arraybuffer' }))
    },

    async listFunctionModules (query: { keyword?: string } = {}): Promise<PersonalFunctionModule[]> {
      const list = await request<PersonalFunctionModule[]>({ url: PERSONAL_USAGE_PATHS.functionModuleList, method: 'get' })
      const keyword = typeof query.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      if (keyword === '') return Array.isArray(list) ? list : []
      return (Array.isArray(list) ? list : []).filter((item) => {
        const label = typeof item === 'string' ? item : String(item.name ?? '')
        return label.toLowerCase().includes(keyword)
      })
    },

    async getModelDetail (id: number | string): Promise<Record<string, unknown>> {
      requireId(id, '模型 id')
      return request({ url: `${PERSONAL_USAGE_PATHS.modelDetail}/${id}`, method: 'get' })
    },

    prepareApply (draft: PersonalApplyDraft): PersonalApplyPreparation {
      return preparePersonalApply(draft)
    },

    async submitApply (draft: PersonalApplyDraft): Promise<number | string> {
      const prepared = preparePersonalApply(draft)
      const result = await request<unknown>({ url: PERSONAL_USAGE_PATHS.applyCreate, method: 'post', data: prepared.payload })
      const id = typeof result === 'object' && result !== null && 'id' in result ? (result as { id?: unknown }).id : result
      return requireId(id, '额度申请 id')
    },

    async listApplyRecords (query: PersonalApplyQuery = {}): Promise<PageResult<PersonalApplyRow>> {
      return pageOf<PersonalApplyRow>(await request({ url: PERSONAL_USAGE_PATHS.applyPage, method: 'get', params: applyRecordParams(query) }))
    },

    cancelApply (): { cancelled: boolean } {
      return { cancelled: true }
    },
  }
}

export type ModelUsageCapability = ReturnType<typeof createModelUsageCapability>
