import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品设置 → 业务管理 → 鸡群批次状态」。 */
export const PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH = '/dashboard/product/setting/business-manage/batch-status/list'
export const PRODUCT_SETTING_BATCH_STATUS_PERMISSION = '/dashboard/frame/business/batch-status'
export const PRODUCT_SETTING_BATCH_STATUS_MODULE_TYPE = null
export const PRODUCT_SETTING_BATCH_STATUS_QUERY_PERMISSION = 'management:batch-status:query'
export const PRODUCT_SETTING_BATCH_STATUS_SUBMIT_PERMISSION = 'management:batch-status:submit'

const LIST_URL = '/flockStatus/list'
const BUILDING_LIST_URL = '/config/building/getByFarmId'
const RECOMMEND_END_DAY_URL = '/flockStatus/recommendEndDay'
const TERMINATION_URL = '/flockStatus/termination'
const ACTIVATE_URL = '/flockStatus/activate'

export type ProductSettingBatchStatusId = string | number
export type ProductSettingBatchStatusFlag = 0 | 1

export type ProductSettingBatchStatusQuery = {
  farm: ProductSettingBatchStatusId
  building?: ProductSettingBatchStatusId | null
  stageEndingFlag?: ProductSettingBatchStatusFlag | null
  variety?: string | null
  line?: string | null
  lineVer?: string | null
  gen?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingBatchStatusRow = Record<string, unknown> & {
  id: ProductSettingBatchStatusId | null
  groupId: ProductSettingBatchStatusId | null
  batch: string | null
  farmName: string | null
  buildingName: string | null
  stageStartDate: string | null
  stageEndDate: string | null
  maleQty: number | null
  femaleQty: number | null
  varietyName: string | null
  lineName: string | null
  lineVer: string | null
  genName: string | null
  genNucleusName: string | null
}

export type ProductSettingBatchStatusPage = {
  list: ProductSettingBatchStatusRow[]
  total: number
}

export type ProductSettingBatchStatusBuildingOption = {
  value: ProductSettingBatchStatusId
  label: string
}

export type ProductSettingBatchStatusTerminationDraft = {
  groupId: ProductSettingBatchStatusId
  stageEndDate: string
}

export type ProductSettingBatchStatusTerminationResult = {
  completed: boolean
  confirmationRequired: boolean
  message: string | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function idOf (value: unknown, label: string): ProductSettingBatchStatusId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingBatchStatusId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  return textOf(value, label)
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function dateOnlyOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) throw new Error(`${label}必须为YYYY-MM-DD`)
  return value
}

function nullableDateOnlyOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return dateOnlyOf(value, label)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function flagOf (value: unknown, label: string): ProductSettingBatchStatusFlag | '' {
  if (value === undefined || value === null || value === '') return ''
  if (value === 0 || value === 1) return value
  throw new Error(`${label}只能是0（未终止）或1（已终止）`)
}

function queryOf (query: ProductSettingBatchStatusQuery): JsonObject {
  return {
    order: '',
    orderField: '',
    farm: idOf(query.farm, '场区'),
    building: nullableIdOf(query.building, '栋号') ?? '',
    stageEndingFlag: flagOf(query.stageEndingFlag, '批次状态'),
    variety: textOf(query.variety, '品种') ?? '',
    line: textOf(query.line, '品系') ?? '',
    lineVer: textOf(query.lineVer, '品系版本') ?? '',
    gen: textOf(query.gen, '代次') ?? '',
    scope: 1,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingBatchStatusRow {
  const row = objectOf(value, `鸡群批次状态列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `鸡群批次状态列表[${index}].id`),
    groupId: nullableIdOf(row.groupId, `鸡群批次状态列表[${index}].groupId`),
    batch: nullableTextOf(row.batch, `鸡群批次状态列表[${index}].batch`),
    farmName: nullableTextOf(row.farmName, `鸡群批次状态列表[${index}].farmName`),
    buildingName: nullableTextOf(row.buildingName, `鸡群批次状态列表[${index}].buildingName`),
    stageStartDate: nullableDateOnlyOf(row.stageStartDate, `鸡群批次状态列表[${index}].stageStartDate`),
    stageEndDate: nullableDateOnlyOf(row.stageEndDate, `鸡群批次状态列表[${index}].stageEndDate`),
    maleQty: integerOf(row.maleQty, `鸡群批次状态列表[${index}].maleQty`),
    femaleQty: integerOf(row.femaleQty, `鸡群批次状态列表[${index}].femaleQty`),
    varietyName: nullableTextOf(row.varietyName, `鸡群批次状态列表[${index}].varietyName`),
    lineName: nullableTextOf(row.lineName, `鸡群批次状态列表[${index}].lineName`),
    lineVer: nullableTextOf(row.lineVer, `鸡群批次状态列表[${index}].lineVer`),
    genName: nullableTextOf(row.genName, `鸡群批次状态列表[${index}].genName`),
    genNucleusName: nullableTextOf(row.genNucleusName, `鸡群批次状态列表[${index}].genNucleusName`),
  }
}

function pageOf (value: unknown): ProductSettingBatchStatusPage {
  const envelope = objectOf(value, '鸡群批次状态分页响应')
  const page = objectOf(envelope.page ?? envelope, '鸡群批次状态分页响应.page')
  const list = page.list || page.records || page.rows || []
  const total = page.total || page.count || 0
  if (!Array.isArray(list) || !Number.isSafeInteger(total) || (total as number) < 0) throw new Error('鸡群批次状态分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: total as number }
}

function buildingOptionsOf (value: unknown): ProductSettingBatchStatusBuildingOption[] {
  const envelope = Array.isArray(value) ? value : objectOf(value, '栋号响应')
  const list = Array.isArray(envelope) ? envelope : envelope.list
  if (!Array.isArray(list)) throw new Error('栋号响应缺少list数组')
  return list.map((item, index) => {
    const building = objectOf(item, `栋号[${index}]`)
    return {
      value: idOf(building.id, `栋号[${index}].id`),
      label: requiredTextOf(building.shortName, `栋号[${index}].shortName`),
    }
  })
}

function terminationDraftOf (value: unknown): ProductSettingBatchStatusTerminationDraft {
  const input = objectOf(value, '批次终止表单')
  const groupId = idOf(input.groupId, '批次组ID')
  const stageEndDate = dateOnlyOf(input.stageEndDate, '终止日期')
  const stageStartDate = nullableDateOnlyOf(input.stageStartDate, '进鸡日期')
  if (stageStartDate && stageEndDate < stageStartDate) throw new Error('终止日期不能早于进鸡日期')
  return { groupId, stageEndDate }
}

function confirmFlagOf (value: unknown): ProductSettingBatchStatusFlag {
  if (value === undefined || value === null) return 0
  if (value === 0 || value === 1) return value
  throw new Error('isConfirm只能是0或1')
}

function terminationResultOf (value: unknown): ProductSettingBatchStatusTerminationResult {
  let current: unknown = value
  let message: string | null = null
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    const envelope = current as JsonObject
    message = textOf(envelope.msg, '批次终止响应.msg')
    if (envelope.data !== undefined && envelope.data !== null) current = envelope.data
  }
  let confirmationRequired = false
  if (current === 1) confirmationRequired = true
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    confirmationRequired = (current as JsonObject).isConfirm === 1
    message = textOf((current as JsonObject).msg, '批次终止响应.msg') ?? message
  }
  return { completed: !confirmationRequired, confirmationRequired, message }
}

/** The injected request must use PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH as its page context. */
export function createProductSettingBatchStatusCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingBatchStatusQuery): Promise<ProductSettingBatchStatusPage> {
      return pageOf(await request({ url: LIST_URL, method: 'get', params: queryOf(query) }))
    },

    async buildingList (input: { farmId: ProductSettingBatchStatusId }): Promise<ProductSettingBatchStatusBuildingOption[]> {
      const farmId = idOf(input?.farmId, '场区ID')
      return buildingOptionsOf(await request({ url: BUILDING_LIST_URL, method: 'get', params: { farmId } }))
    },

    async recommendEndDay (input: { groupId: ProductSettingBatchStatusId }): Promise<string | null> {
      const groupId = idOf(input?.groupId, '批次组ID')
      return nullableDateOnlyOf(await request({ url: RECOMMEND_END_DAY_URL, method: 'get', params: { groupId } }), '推荐终止日期')
    },

    prepareTermination (input: { groupId: ProductSettingBatchStatusId; stageEndDate: string; stageStartDate?: string | null }): { draft: ProductSettingBatchStatusTerminationDraft } {
      return { draft: terminationDraftOf(input) }
    },

    async termination (input: { draft: ProductSettingBatchStatusTerminationDraft; isConfirm?: ProductSettingBatchStatusFlag }): Promise<ProductSettingBatchStatusTerminationResult> {
      const draft = terminationDraftOf(input?.draft)
      const isConfirm = confirmFlagOf(input?.isConfirm)
      return terminationResultOf(await request({
        url: TERMINATION_URL,
        method: 'post',
        data: { groupId: draft.groupId, stageEndDate: draft.stageEndDate, isConfirm },
      }))
    },

    async activate (input: { groupId: ProductSettingBatchStatusId }): Promise<true> {
      const groupId = idOf(input?.groupId, '批次组ID')
      await request({ url: ACTIVATE_URL, method: 'post', data: null, params: { groupId } })
      return true
    },
  }
}

export type ProductSettingBatchStatusCapability = ReturnType<typeof createProductSettingBatchStatusCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, description, ...(options ? { options } : {}) })

export const PRODUCT_SETTING_BATCH_STATUS_METHODS = {
  'product-setting-batch-status-list': 'list',
  'product-setting-batch-status-building-list': 'buildingList',
  'product-setting-batch-status-recommend-end-day': 'recommendEndDay',
  'product-setting-batch-status-prepare-termination': 'prepareTermination',
  'product-setting-batch-status-termination': 'termination',
  'product-setting-batch-status-activate': 'activate',
} as const

export const productSettingBatchStatusCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-batch-status-list', title: '查询鸡群批次状态', write: false, params: [p('farm', 'text', true, '场区ID；页面查询规则要求非空'), p('building', 'text', false, '栋号ID；默认空字符串'), p('stageEndingFlag', 'enum', false, '批次状态：0未终止、1已终止；默认空字符串', [{ label: '未终止', value: 0 }, { label: '已终止', value: 1 }]), p('variety', 'text', false, '品种字典值；默认空字符串'), p('line', 'text', false, '品系字典值；默认空字符串'), p('lineVer', 'text', false, '品系版本；默认空字符串'), p('gen', 'text', false, '代次字典值；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-batch-status-building-list', title: '查询鸡群批次状态栋号', write: false, params: [p('farmId', 'text', true, '场区ID')] },
  { id: 'product-setting-batch-status-recommend-end-day', title: '查询鸡群批次推荐终止日期', write: false, params: [p('groupId', 'text', true, '当前列表行的批次组ID')] },
  { id: 'product-setting-batch-status-prepare-termination', title: '准备终止鸡群批次', write: false, params: [p('groupId', 'text', true, '当前列表行groupId'), p('stageEndDate', 'date', true, '终止日期；YYYY-MM-DD且不能早于进鸡日期'), p('stageStartDate', 'date', false, '当前列表行进鸡日期；用于复刻日期选择器的不可选边界')] },
  { id: 'product-setting-batch-status-termination', title: '终止鸡群批次', write: true, params: [p('draft', 'text', true, 'prepareTermination返回的draft'), p('isConfirm', 'enum', false, '后端二次确认标志：0先检查、1用户确认继续；默认0', [{ label: '先检查', value: 0 }, { label: '确认继续', value: 1 }])] },
  { id: 'product-setting-batch-status-activate', title: '恢复鸡群批次', write: true, params: [p('groupId', 'text', true, '当前列表行的批次组ID')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH,
  permission: PRODUCT_SETTING_BATCH_STATUS_PERMISSION,
  moduleType: PRODUCT_SETTING_BATCH_STATUS_MODULE_TYPE,
  httpInstance: 'product',
}))
