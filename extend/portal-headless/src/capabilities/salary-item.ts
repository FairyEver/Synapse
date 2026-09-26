import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力系统 → 薪酬管理 → 基础设置 → 薪资项目」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const SALARY_ITEM_PAGE_PATH = '/dashboard/manage/salary/list'
const ROOT = '/salary/item'

export type SalaryItemId = string | number
export type SalaryItemAttribute = 1 | 2 | 3 | 4
export type SalaryItemType = 1 | 2 | 3 | 4 | 5 | 6
export type SalaryItemCarryRule = 1 | 2 | 3
export type SalaryItemFlag = 0 | 1

export type SalaryItemQuery = {
  attribute?: SalaryItemAttribute | null
  type?: SalaryItemType | null
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type SalaryItemRow = {
  id?: SalaryItemId | null
  name: string | null
  isMust: SalaryItemFlag | null
  attribute: SalaryItemAttribute | null
  type: SalaryItemType | null
  scale: number | null
  carryRule: SalaryItemCarryRule | null
  remark: string | null
  formula?: string | null
  parameter?: SalaryItemId | null
  parameterName?: string | null
  isDefault?: SalaryItemFlag | null
  isDel?: SalaryItemFlag | null
  createTime?: string | null
  updateTime?: string | null
  [key: string]: unknown
}

export type SalaryItemDraft = {
  name: string
  isMust?: SalaryItemFlag
  attribute: SalaryItemAttribute
  formula?: string | null
  parameter?: SalaryItemId | null | ''
  type: SalaryItemType
  scale: number
  carryRule: SalaryItemCarryRule
  remark?: string | null
}

export type SalaryItemUpdate = SalaryItemDraft & { id: SalaryItemId }

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SalaryItemId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  return value
}

function optionalIdOf (value: unknown, label: string): SalaryItemId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string, allowEmpty = true): string {
  if (value === undefined || value === null) return allowEmpty ? '' : (() => { throw new Error(`${label}必须为字符串`) })()
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string, max: number): string {
  const text = textOf(value, label)
  if (!text.trim()) throw new Error(`${label}必填且不能全为空格`)
  if (text.length > max) throw new Error(`${label}最多${max}个字符`)
  return text
}

function enumOf<T extends number> (value: unknown, values: readonly T[], label: string): T {
  if (!Number.isSafeInteger(value) || !values.includes(value as T)) throw new Error(`${label}必须是${values.join('、')}`)
  return value as T
}

function flagOf (value: unknown, label: string): SalaryItemFlag {
  return enumOf(value, [0, 1] as const, label)
}

function integerBetweenOf (value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label}必须是${min}至${max}的整数`)
  return Number(value)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

function queryOf (query: SalaryItemQuery = {}): Record<string, unknown> {
  if (query.name !== undefined && query.name !== null && typeof query.name !== 'string') throw new Error('name必须为字符串或null')
  const attribute = query.attribute === undefined || query.attribute === null ? '' : enumOf(query.attribute, [1, 2, 3, 4] as const, 'attribute')
  const type = query.type === undefined || query.type === null ? '' : enumOf(query.type, [1, 2, 3, 4, 5, 6] as const, 'type')
  return {
    order: '',
    orderField: '',
    attribute,
    type,
    name: query.name ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, label = '薪资项目'): SalaryItemRow {
  const row = objectOf(value, label)
  const nullableEnum = <T extends number> (item: unknown, values: readonly T[], field: string): T | null => item === undefined || item === null || item === '' ? null : enumOf(item, values, `${label}.${field}`)
  const nullableFlag = (item: unknown, field: string): SalaryItemFlag | null => item === undefined || item === null || item === '' ? null : flagOf(item, `${label}.${field}`)
  const nullableInteger = (item: unknown, field: string): number | null => item === undefined || item === null || item === '' ? null : integerBetweenOf(item, 0, 4, `${label}.${field}`)
  return {
    ...row,
    id: optionalIdOf(row.id, `${label}.id`),
    name: row.name === undefined || row.name === null ? null : textOf(row.name, `${label}.name`),
    isMust: nullableFlag(row.isMust, 'isMust'),
    attribute: nullableEnum(row.attribute, [1, 2, 3, 4] as const, 'attribute'),
    type: nullableEnum(row.type, [1, 2, 3, 4, 5, 6] as const, 'type'),
    scale: nullableInteger(row.scale, 'scale'),
    carryRule: nullableEnum(row.carryRule, [1, 2, 3] as const, 'carryRule'),
    remark: row.remark === undefined || row.remark === null ? null : textOf(row.remark, `${label}.remark`),
    ...(row.formula === undefined ? {} : { formula: row.formula === null ? null : textOf(row.formula, `${label}.formula`) }),
    ...(row.parameter === undefined ? {} : { parameter: optionalIdOf(row.parameter, `${label}.parameter`) }),
    ...(row.parameterName === undefined ? {} : { parameterName: row.parameterName === null ? null : textOf(row.parameterName, `${label}.parameterName`) }),
    ...(row.isDefault === undefined ? {} : { isDefault: nullableFlag(row.isDefault, 'isDefault') }),
    ...(row.isDel === undefined ? {} : { isDel: nullableFlag(row.isDel, 'isDel') }),
    ...(row.createTime === undefined ? {} : { createTime: row.createTime === null ? null : textOf(row.createTime, `${label}.createTime`) }),
    ...(row.updateTime === undefined ? {} : { updateTime: row.updateTime === null ? null : textOf(row.updateTime, `${label}.updateTime`) }),
  }
}

function parameterOf (value: unknown): SalaryItemId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, 'parameter')
}

function draftOf (input: SalaryItemDraft, label = '薪资项目表单'): SalaryItemDraft & { isMust: SalaryItemFlag; formula: string; parameter: SalaryItemId | null | '' ; remark: string } {
  const value = objectOf(input, label)
  const attribute = enumOf(value.attribute, [1, 2, 3, 4] as const, `${label}.attribute`)
  const formula = textOf(value.formula, `${label}.formula`)
  if (attribute === 2 && !formula.trim()) throw new Error('计算项的formula必填')
  const parameter = attribute === 4 ? parameterOf(value.parameter) : ''
  if (attribute === 4 && parameter === null) throw new Error('系统参数的parameter必填')
  const remark = textOf(value.remark, `${label}.remark`)
  if (remark && !remark.trim()) throw new Error('remark不能全为空格')
  if (remark.length > 200) throw new Error('remark最多200个字符')
  return {
    name: requiredTextOf(value.name, `${label}.name`, 50),
    isMust: value.isMust === undefined || value.isMust === null || value.isMust === '' ? 0 : flagOf(value.isMust, `${label}.isMust`),
    attribute,
    formula: attribute === 2 ? formula : '',
    parameter,
    type: enumOf(value.type, [1, 2, 3, 4, 5, 6] as const, `${label}.type`),
    scale: integerBetweenOf(value.scale, 0, 4, `${label}.scale`),
    carryRule: enumOf(value.carryRule, [1, 2, 3] as const, `${label}.carryRule`),
    remark,
  }
}

function updateOf (input: SalaryItemUpdate): SalaryItemUpdate & ReturnType<typeof draftOf> {
  const value = objectOf(input, '薪资项目修改表单')
  return { id: idOf(value.id, '薪资项目id'), ...draftOf(input, '薪资项目修改表单') }
}

function idsOf (value: unknown): SalaryItemId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('ids至少包含一个薪资项目ID')
  const ids = value.map((item, index) => idOf(item, `ids[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('ids不能包含重复ID')
  return ids
}

export function createSalaryItemCapability (request: PortalRequest) {
  return {
    async list (query: SalaryItemQuery = {}): Promise<PageResult<SalaryItemRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('薪资项目分页响应缺少有效list或total')
      return { list: result.list.map(item => rowOf(item, '薪资项目列表行')), total: result.total }
    },
    async get (input: { id: SalaryItemId }): Promise<SalaryItemRow> {
      return rowOf(await request<unknown>({ url: `${ROOT}/${idOf(input?.id, '薪资项目id')}`, method: 'get' }), '薪资项目详情')
    },
    async all (): Promise<SalaryItemRow[]> {
      const result = await request<unknown>({ url: `${ROOT}/getAllSalaryItem`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('薪资项目全量响应必须是数组')
      return result.map(item => rowOf(item, '薪资项目候选'))
    },
    async checkFormula (input: { formula: string }): Promise<void> {
      const formula = textOf(input?.formula, 'formula')
      if (!formula.trim()) throw new Error('formula不能为空')
      await request({ url: `${ROOT}/checkFormula`, method: 'get', params: { formula } })
    },
    async create (input: SalaryItemDraft): Promise<void> {
      const draft = draftOf(input)
      if (draft.attribute === 2) await this.checkFormula({ formula: draft.formula })
      await request({ url: ROOT, method: 'post', data: draft })
    },
    async update (input: SalaryItemUpdate): Promise<void> {
      const draft = updateOf(input)
      if (draft.attribute === 2) await this.checkFormula({ formula: draft.formula })
      await request({ url: ROOT, method: 'put', data: draft })
    },
    prepareRemove (input: { ids: SalaryItemId[] }): { ids: SalaryItemId[] } {
      return { ids: idsOf(input?.ids) }
    },
    async remove (input: { ids: SalaryItemId[] }): Promise<void> {
      const prepared = this.prepareRemove(input)
      await request({ url: ROOT, method: 'delete', data: prepared.ids })
    },
  }
}

export type SalaryItemCapability = ReturnType<typeof createSalaryItemCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [p('attribute', 'enum', false, '属性：1固定项、2计算项、3外部数据、4系统参数'), p('type', 'enum', false, '类型：1税前加、2税后加、3税前减、4税后减、5计算过渡、6结果'), p('name', 'text'), p('pageNo', 'number'), p('pageSize', 'number')]
const draftParams: ParamSpec[] = [p('name', 'text', true, '最多50字符且不能全为空格'), p('isMust', 'enum', false, '0否、1是；省略按Portal默认0'), p('attribute', 'enum', true), p('formula', 'text', false, 'attribute=2时必填，提交前调用checkFormula'), p('parameter', 'text', false, 'attribute=4时必填，提交前为正整数ID'), p('type', 'enum', true), p('scale', 'number', true, '0至4整数'), p('carryRule', 'enum', true, '1四舍五入、2向上取整、3向下取整'), p('remark', 'text', false, '最多200字符，不得为非空全空格文本')]

export const SALARY_ITEM_METHODS = {
  'salary-item-list': 'list',
  'salary-item-get': 'get',
  'salary-item-all': 'all',
  'salary-item-check-formula': 'checkFormula',
  'salary-item-create': 'create',
  'salary-item-update': 'update',
  'salary-item-prepare-remove': 'prepareRemove',
  'salary-item-remove': 'remove',
} as const

export const salaryItemCapabilities: CapabilityDefinition[] = [
  { id: 'salary-item-list', title: '查询薪资项目', write: false, params: queryParams },
  { id: 'salary-item-get', title: '读取薪资项目编辑表单', write: false, params: [p('id', 'text', true)] },
  { id: 'salary-item-all', title: '查询薪资项目公式候选', write: false, params: [] },
  { id: 'salary-item-check-formula', title: '校验薪资项目公式', write: false, params: [p('formula', 'text', true)] },
  { id: 'salary-item-create', title: '创建薪资项目', write: true, params: draftParams },
  { id: 'salary-item-update', title: '修改薪资项目', write: true, params: [p('id', 'text', true), ...draftParams] },
  { id: 'salary-item-prepare-remove', title: '准备删除薪资项目', write: false, params: [p('ids', 'text', true)] },
  { id: 'salary-item-remove', title: '删除薪资项目', write: true, params: [p('ids', 'text', true)] },
].map(definition => ({ ...definition, pagePath: SALARY_ITEM_PAGE_PATH, permission: '/dashboard/manage/salary', moduleType: 14, httpInstance: 'platform' }))
