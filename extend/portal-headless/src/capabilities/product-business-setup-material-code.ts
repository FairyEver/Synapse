import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 业务管理 → 设置蛋鸡场物料号」。 */
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH = '/dashboard/product/setting/business-manage/setup-material-code/list'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION = '/dashboard/frame/business/setup-material-code-farm'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_QUERY_PERMISSION = 'layer-farm:set-material-code-farm:query'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_QUERY_PERMISSION = 'layer-farm:setup-material-code-batch:query'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MODULE_TYPE = null

export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_LIST_URL = '/base/setupMaterialCode/farmMaterialList'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_LIST_URL = '/base/setupMaterialCode/batchMaterialList'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_LOOKUP_URL = '/base/setupMaterialCode/farmMaterial'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_LOOKUP_URL = '/base/setupMaterialCode/batchMaterial'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_SUBMIT_URL = '/base/setupMaterialCode/farmMaterialSubmit'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BUILDING_URL = '/config/building/getByFarmId'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_OPTIONS_URL = '/base/setupMaterialCode/getFlockBatch'
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIAL_OPTIONS_URL = '/consumeMaterial/getMaterialList'

export type ProductBusinessSetupMaterialCodeId = string | number
export type ProductBusinessSetupMaterialCodeScalar = string | number

export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS = [
  { prop: 'eliminate', label: '淘汰鸡', description: '淘汰鸡' },
  { prop: 'seedEgg', label: '种蛋', description: '种蛋' },
  { prop: 'fecunditySeedEgg', label: '繁殖力种蛋', description: '繁殖力/种蛋' },
  { prop: 'combiningAbilitySeedEgg', label: '配合力种蛋', description: '配合力/种蛋' },
  { prop: 'parentalGenerationSeedEgg', label: '父母代种蛋', description: '父母代/种蛋' },
  { prop: 'commodityGenerationSeedEgg', label: '商品代种蛋', description: '商品代/种蛋' },
  { prop: 'male', label: '公鸡', description: '公鸡' },
  { prop: 'female', label: '母鸡', description: '母鸡' },
  { prop: 'growing', label: '154日龄育成鸡', description: '154日龄/育成鸡' },
  { prop: 'commodityEgg', label: '商蛋', description: '商蛋' },
  { prop: 'soupEgg', label: '汤蛋', description: '汤蛋' },
  { prop: 'friedEgg', label: '硌蛋', description: '硌蛋' },
  { prop: 'moulting', label: '换羽鸡', description: '换羽鸡' },
  { prop: 'moultingGrowing', label: '换羽育成鸡', description: '换羽/育成鸡' },
] as const

export type ProductBusinessSetupMaterialCodeMaterialProp = typeof PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS[number]['prop']

export type ProductBusinessSetupMaterialCodeQuery = {
  order?: string | null
  orderField?: string | null
  farm?: ProductBusinessSetupMaterialCodeScalar | null
  variety?: ProductBusinessSetupMaterialCodeScalar | null
  line?: ProductBusinessSetupMaterialCodeScalar | null
  gen?: ProductBusinessSetupMaterialCodeScalar | null
  pageNo?: number
  pageSize?: number
}

export type ProductBusinessSetupMaterialCodeBatchListInput = {
  flockGroupId: ProductBusinessSetupMaterialCodeId
  batch: string
}

export type ProductBusinessSetupMaterialCodeBatchOptionsInput = {
  farm?: ProductBusinessSetupMaterialCodeScalar | null
  building?: ProductBusinessSetupMaterialCodeScalar | null
  startDate?: string | null
  endDate?: string | null
}

export type ProductBusinessSetupMaterialCodeFarmLookupInput = {
  farm?: ProductBusinessSetupMaterialCodeScalar | null
  variety?: ProductBusinessSetupMaterialCodeScalar | null
  line?: ProductBusinessSetupMaterialCodeScalar | null
  gen?: ProductBusinessSetupMaterialCodeScalar | null
}

export type ProductBusinessSetupMaterialCodeBatchLookupInput = ProductBusinessSetupMaterialCodeBatchListInput

export type ProductBusinessSetupMaterialCodeMaterialOptionsInput = {
  description: string
}

export type ProductBusinessSetupMaterialCodeRow = Record<string, unknown> & {
  id?: ProductBusinessSetupMaterialCodeId | null
  farm?: ProductBusinessSetupMaterialCodeScalar | null
  farmId?: ProductBusinessSetupMaterialCodeScalar | null
  farmName?: string | null
  building?: ProductBusinessSetupMaterialCodeScalar | null
  batch?: string | null
  startDate?: string | null
  endDate?: string | null
  variety?: ProductBusinessSetupMaterialCodeScalar | null
  varietyName?: string | null
  line?: ProductBusinessSetupMaterialCodeScalar | null
  lineName?: string | null
  gen?: ProductBusinessSetupMaterialCodeScalar | null
  genName?: string | null
}

export type ProductBusinessSetupMaterialCodePage = {
  list: ProductBusinessSetupMaterialCodeRow[]
  total: number
}

export type ProductBusinessSetupMaterialCodeBatchRow = ProductBusinessSetupMaterialCodeRow

export type ProductBusinessSetupMaterialCodeBuildingOption = Record<string, unknown> & {
  id: ProductBusinessSetupMaterialCodeId
  shortName: string | null
  label: string | null
  value: ProductBusinessSetupMaterialCodeId
}

export type ProductBusinessSetupMaterialCodeBatchOption = Record<string, unknown> & {
  groupId: ProductBusinessSetupMaterialCodeId | null
  batch: string | null
  label: string | null
  value: string | null
}

export type ProductBusinessSetupMaterialCodeMaterialOption = Record<string, unknown> & {
  id: ProductBusinessSetupMaterialCodeId
  materialDescription: string | null
  label: string | null
  value: ProductBusinessSetupMaterialCodeId
}

export type ProductBusinessSetupMaterialCodeForm = Record<string, unknown> & {
  id?: ProductBusinessSetupMaterialCodeId | null | ''
  farmId?: ProductBusinessSetupMaterialCodeScalar | null
  gen?: ProductBusinessSetupMaterialCodeScalar | null
  variety?: ProductBusinessSetupMaterialCodeScalar | null
  line?: ProductBusinessSetupMaterialCodeScalar | null
  flockGroupId?: ProductBusinessSetupMaterialCodeId | null
}

export type ProductBusinessSetupMaterialCodeDraft = Record<string, unknown>

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function scalarOf (value: unknown, label: string): ProductBusinessSetupMaterialCodeScalar {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须为非空字符串或安全整数`)
}

function optionalScalarOf (value: unknown, label: string): ProductBusinessSetupMaterialCodeScalar | '' {
  if (value === undefined || value === null || value === '') return ''
  return scalarOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function formTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function idOf (value: unknown, label: string): ProductBusinessSetupMaterialCodeId {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须为非空ID`)
}

function optionalIdOf (value: unknown, label: string): ProductBusinessSetupMaterialCodeId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, label)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function queryOf (query: ProductBusinessSetupMaterialCodeQuery = {}): Record<string, unknown> {
  return {
    order: formTextOf(query.order, '排序方式'),
    orderField: formTextOf(query.orderField, '排序字段'),
    farm: optionalScalarOf(query.farm, '蛋鸡场'),
    variety: optionalScalarOf(query.variety, '品种'),
    line: optionalScalarOf(query.line, '品系'),
    gen: optionalScalarOf(query.gen, '代次'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductBusinessSetupMaterialCodeRow {
  const row = objectOf(value, `蛋鸡场物料号列表[${index}]`)
  const normalized: ProductBusinessSetupMaterialCodeRow = { ...row }
  if (row.id !== undefined && row.id !== null && row.id !== '') normalized.id = idOf(row.id, `蛋鸡场物料号列表[${index}].id`)
  for (const key of ['farm', 'farmId', 'building', 'variety', 'line', 'gen'] as const) {
    if (row[key] !== undefined) normalized[key] = row[key] === null || row[key] === '' ? null : scalarOf(row[key], `蛋鸡场物料号列表[${index}].${key}`)
  }
  for (const key of ['farmName', 'batch', 'startDate', 'endDate', 'varietyName', 'lineName', 'genName'] as const) {
    if (row[key] !== undefined) normalized[key] = textOf(row[key], `蛋鸡场物料号列表[${index}].${key}`)
  }
  return normalized
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined && object.records === undefined) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductBusinessSetupMaterialCodePage {
  const payload = objectOf(payloadOf(value), '蛋鸡场物料号分页响应')
  const page = objectOf(payload.page ?? payload, '蛋鸡场物料号分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('蛋鸡场物料号分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function rowsOf (value: unknown, label: string): ProductBusinessSetupMaterialCodeRow[] {
  const payload = payloadOf(value)
  if (!Array.isArray(payload)) {
    const object = objectOf(payload, label)
    const list = object.list ?? object.records ?? object.rows
    if (!Array.isArray(list)) throw new Error(`${label}缺少list数组`)
    return list.map((item, index) => rowOf(item, index))
  }
  return payload.map((item, index) => rowOf(item, index))
}

function oneRowOf (value: unknown, label: string): ProductBusinessSetupMaterialCodeRow | null {
  const payload = payloadOf(value)
  if (payload === null || payload === undefined) return null
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    const object = payload as JsonObject
    if (object.SetupMaterialCodeListDTO !== undefined) return oneRowOf(object.SetupMaterialCodeListDTO, label)
  }
  return rowOf(payload, 0)
}

function buildingOptionsOf (value: unknown): ProductBusinessSetupMaterialCodeBuildingOption[] {
  const payload = payloadOf(value)
  if (!Array.isArray(payload)) throw new Error('栋号候选响应必须是数组')
  return payload.map((item, index) => {
    const row = objectOf(item, `栋号候选[${index}]`)
    const id = idOf(row.id, `栋号候选[${index}].id`)
    const shortName = textOf(row.shortName, `栋号候选[${index}].shortName`)
    return { ...row, id, shortName, label: shortName, value: id }
  })
}

function batchOptionsOf (value: unknown): ProductBusinessSetupMaterialCodeBatchOption[] {
  const payload = payloadOf(value)
  if (!Array.isArray(payload)) throw new Error('批次候选响应必须是数组')
  return payload.map((item, index) => {
    const row = objectOf(item, `批次候选[${index}]`)
    const batch = textOf(row.batch, `批次候选[${index}].batch`)
    const groupId = row.groupId === undefined || row.groupId === null || row.groupId === '' ? null : idOf(row.groupId, `批次候选[${index}].groupId`)
    return { ...row, batch, groupId, label: batch, value: batch }
  })
}

function materialOptionsOf (value: unknown): ProductBusinessSetupMaterialCodeMaterialOption[] {
  const payload = payloadOf(value)
  if (!Array.isArray(payload)) throw new Error('物料候选响应必须是数组')
  return payload.map((item, index) => {
    const row = objectOf(item, `物料候选[${index}]`)
    const id = idOf(row.id, `物料候选[${index}].id`)
    const materialDescription = textOf(row.materialDescription, `物料候选[${index}].materialDescription`)
    return { ...row, id, materialDescription, label: materialDescription, value: id }
  })
}

function lookupQueryOf (input: ProductBusinessSetupMaterialCodeFarmLookupInput = {}): Record<string, unknown> {
  return {
    farm: optionalScalarOf(input.farm, '蛋鸡场'),
    variety: optionalScalarOf(input.variety, '品种'),
    line: optionalScalarOf(input.line, '品系'),
    gen: optionalScalarOf(input.gen, '代次'),
  }
}

function batchListInputOf (input: ProductBusinessSetupMaterialCodeBatchListInput): Record<string, unknown> {
  const value = objectOf(input, '批次物料号参数')
  return { flockGroupId: idOf(value.flockGroupId, 'flockGroupId'), batch: formTextOf(value.batch, '批次') }
}

function batchOptionsQueryOf (input: ProductBusinessSetupMaterialCodeBatchOptionsInput = {}): Record<string, unknown> {
  return {
    farm: optionalScalarOf(input.farm, '蛋鸡场'),
    building: optionalScalarOf(input.building, '栋号'),
    startDate: formTextOf(input.startDate, '开始日期'),
    endDate: formTextOf(input.endDate, '结束日期'),
  }
}

function materialOptionsInputOf (input: ProductBusinessSetupMaterialCodeMaterialOptionsInput): string {
  const description = formTextOf(objectOf(input, '物料候选参数').description, '物料描述')
  if (description === '') throw new Error('物料描述不能为空')
  return description
}

function materialValueOf (value: unknown, label: string): ProductBusinessSetupMaterialCodeScalar | '' {
  if (value === undefined || value === null || value === '') return ''
  return scalarOf(value, label)
}

function buildSubmitDraft (value: unknown, mode: 'farm' | 'batch'): ProductBusinessSetupMaterialCodeDraft {
  const form = objectOf(value, `${mode === 'farm' ? '批量' : '批次'}设置物料号提交表单`)
  const payload: JsonObject = {}
  if (form.id !== undefined && form.id !== null && form.id !== '') payload.id = idOf(form.id, '物料号配置行ID')
  if (mode === 'farm') {
    payload.farmId = optionalScalarOf(form.farmId, '场区')
    payload.gen = optionalScalarOf(form.gen, '代次')
    payload.variety = optionalScalarOf(form.variety, '品种')
    payload.line = optionalScalarOf(form.line, '品系')
  } else {
    payload.flockGroupId = idOf(form.flockGroupId, 'flockGroupId')
  }
  for (const material of PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS) {
    payload[`${material.prop}Name`] = material.label || ''
    payload[`${material.prop}RowId`] = optionalIdOf(form[`${material.prop}RowId`], `${material.label}行ID`)
    payload[`${material.prop}MaterialId`] = materialValueOf(form[`${material.prop}MaterialId`], `${material.label}物料ID`)
  }
  return payload
}

/** The injected request must use PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH as page context. */
export function createProductBusinessSetupMaterialCodeCapability (request: PortalRequest) {
  return {
    async farmList (query: ProductBusinessSetupMaterialCodeQuery = {}): Promise<ProductBusinessSetupMaterialCodePage> {
      return pageOf(await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_LIST_URL, method: 'get', params: queryOf(query) }))
    },

    async batchList (input: ProductBusinessSetupMaterialCodeBatchListInput): Promise<ProductBusinessSetupMaterialCodeBatchRow[]> {
      return rowsOf(await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_LIST_URL, method: 'get', params: batchListInputOf(input) }), '批次物料号列表响应')
    },

    async buildingOptions (input: { farmId: ProductBusinessSetupMaterialCodeId }): Promise<ProductBusinessSetupMaterialCodeBuildingOption[]> {
      const farmId = idOf(objectOf(input, '栋号候选参数').farmId, 'farmId')
      return buildingOptionsOf(await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BUILDING_URL, method: 'get', params: { farmId } }))
    },

    async batchOptions (input: ProductBusinessSetupMaterialCodeBatchOptionsInput = {}): Promise<ProductBusinessSetupMaterialCodeBatchOption[]> {
      return batchOptionsOf(await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_OPTIONS_URL, method: 'get', params: batchOptionsQueryOf(input) }))
    },

    async materialOptions (input: ProductBusinessSetupMaterialCodeMaterialOptionsInput): Promise<ProductBusinessSetupMaterialCodeMaterialOption[]> {
      const description = materialOptionsInputOf(input)
      return materialOptionsOf(await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIAL_OPTIONS_URL, method: 'get', params: { description } }))
    },

    async farmMaterial (input: ProductBusinessSetupMaterialCodeFarmLookupInput = {}): Promise<ProductBusinessSetupMaterialCodeRow | null> {
      return oneRowOf(await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_LOOKUP_URL, method: 'get', params: lookupQueryOf(input) }), '批量设置物料号查询响应')
    },

    async batchMaterial (input: ProductBusinessSetupMaterialCodeBatchLookupInput): Promise<ProductBusinessSetupMaterialCodeRow | null> {
      return oneRowOf(await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_LOOKUP_URL, method: 'get', params: batchListInputOf(input) }), '批次设置物料号查询响应')
    },

    prepareFarmSubmit (form: ProductBusinessSetupMaterialCodeForm): { draft: ProductBusinessSetupMaterialCodeDraft } {
      return { draft: buildSubmitDraft(form, 'farm') }
    },

    async farmSubmit (input: { draft: ProductBusinessSetupMaterialCodeDraft }): Promise<true> {
      const draft = buildSubmitDraft(input?.draft, 'farm')
      await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_SUBMIT_URL, method: 'post', data: draft })
      return true
    },

    prepareBatchSubmit (form: ProductBusinessSetupMaterialCodeForm): { draft: ProductBusinessSetupMaterialCodeDraft } {
      return { draft: buildSubmitDraft(form, 'batch') }
    },

    async batchSubmit (input: { draft: ProductBusinessSetupMaterialCodeDraft }): Promise<true> {
      const draft = buildSubmitDraft(input?.draft, 'batch')
      await request({ url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_SUBMIT_URL, method: 'post', data: draft })
      return true
    },
  }
}

export type ProductBusinessSetupMaterialCodeCapability = ReturnType<typeof createProductBusinessSetupMaterialCodeCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS = {
  'product-business-setup-material-code-farm-list': 'farmList',
  'product-business-setup-material-code-batch-list': 'batchList',
  'product-business-setup-material-code-building-options': 'buildingOptions',
  'product-business-setup-material-code-batch-options': 'batchOptions',
  'product-business-setup-material-code-material-options': 'materialOptions',
  'product-business-setup-material-code-farm-material': 'farmMaterial',
  'product-business-setup-material-code-batch-material': 'batchMaterial',
  'product-business-setup-material-code-prepare-farm-submit': 'prepareFarmSubmit',
  'product-business-setup-material-code-farm-submit': 'farmSubmit',
  'product-business-setup-material-code-prepare-batch-submit': 'prepareBatchSubmit',
  'product-business-setup-material-code-batch-submit': 'batchSubmit',
} as const

export const productBusinessSetupMaterialCodeCapabilities: CapabilityDefinition[] = [
  { id: 'product-business-setup-material-code-farm-list', title: '查询蛋鸡场物料号', write: false, params: [p('farm', 'text'), p('variety', 'text'), p('line', 'text'), p('gen', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'product-business-setup-material-code-batch-list', title: '查询批次物料号', write: false, params: [p('flockGroupId', 'text', true, '批次所属鸡群组ID'), p('batch', 'text', true, '批次号')] },
  { id: 'product-business-setup-material-code-building-options', title: '查询蛋鸡场栋号', write: false, params: [p('farmId', 'text', true, '蛋鸡场ID')] },
  { id: 'product-business-setup-material-code-batch-options', title: '查询蛋鸡场批次', write: false, params: [p('farm', 'text'), p('building', 'text'), p('startDate', 'text'), p('endDate', 'text')] },
  { id: 'product-business-setup-material-code-material-options', title: '查询物料候选', write: false, params: [p('description', 'text', true, '页面物料类别描述')] },
  { id: 'product-business-setup-material-code-farm-material', title: '查询蛋鸡场物料配置', write: false, params: [p('farm', 'text'), p('variety', 'text'), p('line', 'text'), p('gen', 'text')] },
  { id: 'product-business-setup-material-code-batch-material', title: '查询批次物料配置', write: false, params: [p('flockGroupId', 'text', true), p('batch', 'text', true)] },
  { id: 'product-business-setup-material-code-prepare-farm-submit', title: '准备提交蛋鸡场物料号', write: false, params: [p('form', 'text', true, '批量设置物料号弹窗表单')] },
  { id: 'product-business-setup-material-code-farm-submit', title: '提交蛋鸡场物料号', write: true, params: [p('draft', 'text', true, 'prepareFarmSubmit返回的草稿')] },
  { id: 'product-business-setup-material-code-prepare-batch-submit', title: '准备提交批次物料号', write: false, params: [p('form', 'text', true, '批次设置物料号弹窗表单')] },
  { id: 'product-business-setup-material-code-batch-submit', title: '提交批次物料号', write: true, params: [p('draft', 'text', true, 'prepareBatchSubmit返回的草稿')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH,
  permission: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION,
  moduleType: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MODULE_TYPE,
  httpInstance: 'product',
}))
