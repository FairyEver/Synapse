import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 程序库」。 */
export const PRODUCT_PROGRAM_LIBRARY_PAGE_PATH = '/dashboard/product/prevention/plan/program-library/list'
export const PRODUCT_PROGRAM_LIBRARY_PERMISSION = '/dashboard/frame/vaccine-plan/program-library'
export const PRODUCT_PROGRAM_LIBRARY_MODULE_TYPE = 45

/** 同一组件挂载的第二个菜单入口；Portal 对该路径无法推导 module-type。 */
export const PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH = '/dashboard/product/setting/program-lib/list'
export const PRODUCT_PROGRAM_LIBRARY_NEW_PERMISSION = '/dashboard/frame/breeding-plan-new/program-library'
export const PRODUCT_PROGRAM_LIBRARY_NEW_MODULE_TYPE = null

const PROGRAM_LIBRARY_API = '/flockSimu/rearingPlan/programLibrary'
const SUPPLY_PAGE_SIZE = 100
const IMPORT_MAX_ROWS = 1000

export const PRODUCT_PROGRAM_PAGE_KEYS = [
  'mianyi', 'touyao', 'xiaodu', 'kangti', 'weisheng', 'poujie', 'siliao-jiance', 'yaomin', 'tingzhen',
  'guangzhao', 'wendu', 'tongfeng', 'shujing', 'qingfen', 'kongchang', 'huanliao', 'dunsi',
] as const

export type ProductProgramPageKey = typeof PRODUCT_PROGRAM_PAGE_KEYS[number]
export type ProductProgramId = string | number
export type ProductProgramFilterValue = string | number | null | undefined
export type ProductProgramDraft = Record<string, unknown> & { id?: ProductProgramId | null }
export type ProductProgramFileInput = {
  fileName: string
  base64: string
  contentType?: string
}
export type ProductProgramFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}
export type ProductProgramSupplyItem = Record<string, unknown> & { id: ProductProgramId }
export type ProductProgramRow = Record<string, unknown> & { id?: ProductProgramId | null }
export type ProductProgramPage = {
  list: ProductProgramRow[]
  total: number
  /** 仅通风矩阵返回；列顺序来自后端 temperatures。 */
  temperatures?: number[]
}
export type ProductProgramTab = Record<string, unknown> & {
  code: string
  name: string
  children: ProductProgramTab[]
}
export type ProductProgramQuery = {
  pageKey: ProductProgramPageKey
  pageNo?: number
  pageSize?: number
  filters?: Record<string, ProductProgramFilterValue>
}
export type ProductProgramPrepareInput = {
  pageKey: ProductProgramPageKey
  draft: ProductProgramDraft
}
export type ProductProgramRemoveInput = {
  pageKey: ProductProgramPageKey
  id: ProductProgramId
}
export type ProductProgramBatchRemoveInput = {
  pageKey: ProductProgramPageKey
  ids: ProductProgramId[]
}
export type ProductProgramVentilationRow = ProductProgramDraft & {
  dayAge: unknown
  frequencyCode: unknown
  cells: unknown[]
  remark?: unknown
  originalDayAge?: unknown
  _originalDayAge?: unknown
}
export type ProductProgramVentilationInput = {
  row: ProductProgramVentilationRow
}
export type ProductProgramTemplateInput = {
  pageKey: ProductProgramPageKey
  programCode?: string
}

type FieldType = 'text' | 'textarea' | 'number' | 'time' | 'day-age' | 'day-age-range' | 'dict' | 'supply'
type FieldRule = {
  dataIndex: string
  title: string
  type: FieldType
  required: boolean
  submit?: boolean
  max?: number
  min?: number
  maxAge?: number
  multiple?: boolean
  supplyType?: 'supplier' | 'material'
}
type PageRule = {
  code: string
  label: string
  apiPath: string
  fields: FieldRule[]
  filters: string[]
  supportsBatchDelete: boolean
}

const text = (dataIndex: string, title: string, options: Partial<FieldRule> = {}): FieldRule => ({ dataIndex, title, type: 'text', required: true, ...options })
const textarea = (dataIndex: string, title: string, options: Partial<FieldRule> = {}): FieldRule => ({ dataIndex, title, type: 'textarea', required: false, ...options })
const number = (dataIndex: string, title: string, options: Partial<FieldRule> = {}): FieldRule => ({ dataIndex, title, type: 'number', required: true, ...options })
const dayAge = (dataIndex: string, title: string, options: Partial<FieldRule> = {}): FieldRule => ({ dataIndex, title, type: 'day-age', required: true, min: 0, maxAge: 700, ...options })
const dayAgeRange = (dataIndex: string, title: string, options: Partial<FieldRule> = {}): FieldRule => ({ dataIndex, title, type: 'day-age-range', required: true, maxAge: 700, max: 50, ...options })
const dict = (dataIndex: string, title: string, options: Partial<FieldRule> = {}): FieldRule => ({ dataIndex, title, type: 'dict', required: true, ...options })
const supply = (dataIndex: string, title: string, supplyType: 'supplier' | 'material', options: Partial<FieldRule> = {}): FieldRule => ({ dataIndex, title, type: 'supply', supplyType, required: true, ...options })
const frequency = (): FieldRule => dict('frequencyCode', '执行频次')
const remark = (max = 3000): FieldRule => textarea('remark', '备注', { max })

/**
 * 页面配置以 Portal program-api.js 为准：字段顺序、submit:false、筛选字段和批量删除能力都在这里集中锁定。
 * 这不是一个通用 DTO 推断器；未列出的字段不会被 SDK 擅自提交。
 */
export const PRODUCT_PROGRAM_PAGE_RULES: Readonly<Record<ProductProgramPageKey, PageRule>> = {
  mianyi: {
    code: 'immunization', label: '免疫程序', apiPath: `${PROGRAM_LIBRARY_API}/immunization/item`, filters: [], supportsBatchDelete: false,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), frequency(), dict('applicableTypes', '鸡类型', { multiple: true }), dict('immuneProject', '免疫项目'), supply('vaccineSupplierId', '疫苗厂家', 'supplier', { required: false }), dict('immuneMethod', '免疫方法'), dict('immuneSite', '免疫部位'), dict('vaccineType', '疫苗类型'), text('vaccineDose', '免疫剂量', { max: 64 }), number('sortNo', '排序号', { required: false, min: 0 })],
  },
  touyao: {
    code: 'medication', label: '投药程序', apiPath: `${'/flockSimu/rearingPlan'}/medication`, filters: ['dayAgeRange', 'medicationName'], supportsBatchDelete: false,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), frequency(), dict('applicableTypes', '鸡类型', { multiple: true }), supply('medicationMaterialId', '药物', 'material'), supply('medicationSupplierId', '厂家', 'supplier', { required: false, submit: false }), text('dosage', '剂量', { max: 100 }), dict('medicationMethod', '投药方法'), number('useDays', '使用天数', { min: 1, max: 365 }), textarea('medicationPurpose', '投药目的', { max: 1000 }), remark()],
  },
  xiaodu: {
    code: 'disinfection', label: '消毒程序', apiPath: `${'/flockSimu/rearingPlan'}/disinfection`, filters: ['dayAgeRange', 'disinfectionSite'], supportsBatchDelete: false,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), frequency(), dict('disinfectionSite', '消毒位置'), text('disinfectionFrequency', '消毒频率', { required: false, max: 100 }), supply('primaryDisinfectantMaterialId', '常用消毒药1', 'material'), supply('secondaryDisinfectantMaterialId', '常用消毒药2', 'material', { required: false }), remark()],
  },
  kangti: {
    code: 'antibody_monitoring', label: '抗体检测程序', apiPath: `${'/flockSimu/rearingPlan'}/antibodyMonitoring`, filters: ['monitoringFrequency', 'antibodyTest'], supportsBatchDelete: false,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), frequency(), text('monitoringFrequency', '监测频率', { max: 100 }), dict('antibodyTests', '抗体监测', { multiple: true }), textarea('antibodyPurposeQuantity', '抗体监测目的及数量', { max: 1000 }), dict('pathogenTests', '病原监测', { multiple: true }), textarea('pathogenPurposeQuantity', '病原监测目的及数量', { max: 1000 }), remark()],
  },
  weisheng: {
    code: 'microorganism', label: '微生物程序', apiPath: `${'/flockSimu/rearingPlan'}/microorganism`, filters: ['dayAgeRange', 'monitoringEnvironment', 'monitoringProject'], supportsBatchDelete: false,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), frequency(), dict('monitoringEnvironment', '监测环境'), dict('monitoringProject', '监测项目'), textarea('monitoringFrequency', '监测频率', { max: 500 }), textarea('monitoringPointQuantity', '监测点及数量', { max: 2000 }), remark()],
  },
  poujie: {
    code: 'necropsy', label: '剖解程序', apiPath: `${'/flockSimu/rearingPlan'}/necropsy`, filters: ['dayAgeRange', 'necropsySite'], supportsBatchDelete: false,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), frequency(), dict('necropsySites', '剖检点', { multiple: true }), remark()],
  },
  'siliao-jiance': {
    code: 'feed_testing', label: '饲料检测程序', apiPath: `${'/flockSimu/rearingPlan'}/feedTesting`, filters: ['season', 'sample'], supportsBatchDelete: false,
    fields: [text('season', '季节', { max: 100 }), dict('samples', '检测样品', { multiple: true }), textarea('monitoringFrequency', '监测频率', { max: 1000 }), remark()],
  },
  yaomin: {
    code: 'drug_sensitivity_testing', label: '药敏试验监测程序', apiPath: `${'/flockSimu/rearingPlan'}/drugSensitivityTesting`, filters: ['dayAgeRange', 'monitoredDisease'], supportsBatchDelete: false,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), frequency(), dict('samplingSites', '采样部位', { multiple: true }), dict('monitoredDiseases', '监控疾病', { multiple: true }), remark()],
  },
  tingzhen: {
    code: 'respiratory_auscultation', label: '听诊程序', apiPath: `${'/flockSimu/rearingPlan'}/respiratoryAuscultation`, filters: ['dayAgeRange', 'auscultationDesc'], supportsBatchDelete: false,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), frequency(), text('auscultationDesc', '呼吸道听诊内容', { max: 100 }), remark(500)],
  },
  guangzhao: {
    code: 'lighting', label: '光照程序', apiPath: `${'/flockSimu/rearingPlan'}/lightProgram`, filters: ['startDayAge', 'endDayAge', 'lightIntensityLux'], supportsBatchDelete: true,
    fields: [dayAge('startDayAge', '起始日龄'), dayAge('endDayAge', '结束日龄'), frequency(), number('lightMinutes', '光照时长（分钟）', { min: 0, max: 1440 }), number('lightIntensityLux', '光照强度（lux）', { required: false, min: 0 }), { dataIndex: 'darkStartTime', title: '关灯开始时间', type: 'time', required: false }, { dataIndex: 'darkEndTime', title: '关灯结束时间', type: 'time', required: false }, textarea('adjustmentDesc', '调节说明', { max: 500 }), remark(500)],
  },
  wendu: {
    code: 'temperature', label: '温度湿度程序', apiPath: `${'/flockSimu/rearingPlan'}/tempHumidity`, filters: ['startDayAge', 'endDayAge', 'stageName'], supportsBatchDelete: true,
    fields: [text('stageName', '饲养阶段', { max: 50 }), dayAge('startDayAge', '起始日龄'), dayAge('endDayAge', '结束日龄'), frequency(), number('minTemperatureCelsius', '最低温度（℃）', { min: -50, max: 60 }), number('maxTemperatureCelsius', '最高温度（℃）', { min: -50, max: 60 }), number('minHumidityPercent', '最低湿度（%）', { min: 0, max: 100 }), number('maxHumidityPercent', '最高湿度（%）', { min: 0, max: 100 }), remark(500)],
  },
  tongfeng: {
    code: 'ventilation', label: '通风程序', apiPath: `${'/flockSimu/rearingPlan'}/ventilation`, filters: [], supportsBatchDelete: true,
    fields: [dayAge('dayAge', '日龄'), frequency(), remark(500)],
  },
  shujing: {
    code: 'insemination', label: '输精程序', apiPath: `${'/flockSimu/rearingPlan'}/insemination`, filters: ['stageName', 'workContent', 'responsiblePerson'], supportsBatchDelete: true,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), text('stageName', '阶段/日龄', { max: 50 }), text('workContent', '工作内容', { max: 100 }), textarea('operationDetail', '具体操作', { required: true, max: 500 }), text('frequency', '频率', { required: false, max: 100 }), frequency(), text('responsiblePerson', '责任人', { required: false, max: 100 }), remark(500)],
  },
  qingfen: {
    code: 'manure_cleaning', label: '清粪程序', apiPath: `${'/flockSimu/rearingPlan'}/manure`, filters: ['startDayAge', 'endDayAge', 'cleaningCount'], supportsBatchDelete: true,
    fields: [dayAge('startDayAge', '起始日龄'), dayAge('endDayAge', '结束日龄'), frequency(), number('cleaningCount', '每日清粪次数', { min: 0, max: 20 }), text('cleaningDesc', '清粪程序说明', { max: 100 }), remark(500)],
  },
  kongchang: {
    code: 'empty_house', label: '空舍程序', apiPath: `${'/flockSimu/rearingPlan'}/emptyHouse`, filters: ['timeNode', 'workContent', 'responsiblePerson'], supportsBatchDelete: true,
    fields: [dayAgeRange('dayAgeRange', '日龄/阶段'), text('timeNode', '时间节点', { max: 50 }), text('workContent', '工作内容', { max: 100 }), textarea('operationDetail', '具体操作', { required: true, max: 500 }), frequency(), text('responsiblePerson', '责任人', { required: false, max: 100 }), number('sortOrder', '排序', { required: false, min: 0 }), remark(500)],
  },
  huanliao: {
    code: 'feed_change', label: '换料程序', apiPath: `${'/flockSimu/rearingPlan'}/feedChange`, filters: ['variety', 'dayAge'], supportsBatchDelete: true,
    fields: [dict('variety', '品种'), dayAgeRange('dayAge', '日龄'), frequency(), text('henFeed', '母鸡饲料', { max: 200 }), text('maleFeed', '公鸡', { required: false, max: 200 }), number('sortOrder', '排序', { required: false, min: 0 }), remark(500)],
  },
  dunsi: {
    code: 'meal_feeding', label: '顿饲程序', apiPath: `${'/flockSimu/rearingPlan'}/mealFeeding`, filters: ['dayAge', 'feedingCount'], supportsBatchDelete: true,
    fields: [dayAgeRange('dayAge', '日龄'), frequency(), number('feedingCount', '饲喂次数', { min: 1, max: 20 }), text('feedingTime', '饲喂时间', { max: 200 }), text('feedingAmount', '饲喂量', { max: 200 }), number('levelingCount', '匀料次数', { min: 0, max: 20 }), text('emptyTroughDuration', '空槽时长', { required: false, max: 100 }), text('lighting', '光照', { max: 100 }), number('sortOrder', '排序', { required: false, min: 0 }), remark(500)],
  },
}

const jsonObject = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function pageRuleOf (pageKey: unknown): PageRule {
  if (typeof pageKey !== 'string' || !PRODUCT_PROGRAM_PAGE_KEYS.includes(pageKey as ProductProgramPageKey)) throw new Error(`pageKey必须是程序库支持的页面：${PRODUCT_PROGRAM_PAGE_KEYS.join('、')}`)
  return PRODUCT_PROGRAM_PAGE_RULES[pageKey as ProductProgramPageKey]
}

function idOf (value: unknown, label: string): ProductProgramId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  throw new Error(`${label}必须是非空ID`)
}

function optionalIdOf (value: unknown, label: string): ProductProgramId | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return idOf(value, label)
}

function hasValue (value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
}

function textOf (value: unknown, label: string, required = false, max?: number): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return ''
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (required && value.trim() === '') throw new Error(`${label}不能为空`)
  if (max !== undefined && value.length > max) throw new Error(`${label}不能超过${max}个字符`)
  return value.trim()
}

function finiteNumberOf (value: unknown, label: string, required: boolean, min?: number, max?: number): number | undefined {
  if (!hasValue(value)) {
    if (required) throw new Error(`${label}不能为空`)
    return undefined
  }
  const result = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(result)) throw new Error(`${label}必须是数字`)
  if (min !== undefined && result < min) throw new Error(`${label}不能小于${min}`)
  if (max !== undefined && result > max) throw new Error(`${label}不能大于${max}`)
  return result
}

function dayAgeOf (value: unknown, label: string, required: boolean, maxAge = 700): number | undefined {
  const result = finiteNumberOf(value, label, required)
  if (result === undefined) return undefined
  if (!Number.isInteger(result) || Math.abs(result) > maxAge) throw new Error(`${label}必须是绝对值不超过${maxAge}的整数`)
  return result
}

function dayAgeRangeOf (value: unknown, label: string, required: boolean, maxAge = 700, maxLength = 50): string {
  const raw = textOf(value, label, required, maxLength)
  if (!raw) return raw
  const match = raw.match(/^(-?\d+)(?:\s*-\s*(.*))?$/)
  if (!match) throw new Error(`${label}请输入日龄或日龄区间`)
  const start = Number(match[1])
  if (!Number.isInteger(start) || Math.abs(start) > maxAge) throw new Error(`${label}不能超过${maxAge}`)
  if (match[2] === undefined) return raw
  const endText = match[2].trim()
  if (!endText) throw new Error(`${label}请输入日龄或日龄区间`)
  if (!/^-?\d+$/.test(endText)) return raw
  const end = Number(endText)
  if (!Number.isInteger(end) || Math.abs(end) > maxAge) throw new Error(`${label}不能超过${maxAge}`)
  if (start > end) throw new Error(`${label}结束日龄不能小于起始日龄`)
  return `${start}-${end}`
}

function arrayOf (value: unknown, label: string, required: boolean): unknown[] {
  if (!hasValue(value)) {
    if (required) throw new Error(`${label}不能为空`)
    return []
  }
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (required && value.length === 0) throw new Error(`${label}不能为空`)
  return value.filter(item => item !== undefined && item !== null && item !== '')
}

function supplyIdOf (value: unknown, label: string, required: boolean): number | undefined {
  const raw = textOf(value, label, required)
  if (!raw) return undefined
  const result = Number(raw)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label}必须是正整数ID`)
  return result
}

function validateDraft (pageKey: ProductProgramPageKey, input: unknown, requireId: boolean): Record<string, unknown> {
  const rule = pageRuleOf(pageKey)
  if (pageKey === 'tongfeng') throw new Error('通风程序使用矩阵方法；请调用ventilation方法')
  const draft = jsonObject(input, '程序库表单')
  const id = optionalIdOf(draft.id, '程序记录ID')
  if (requireId && id === undefined) throw new Error('更新程序记录必须提供id')
  if (!requireId && id !== undefined) throw new Error('新建程序记录不能提供id')

  const payload: Record<string, unknown> = {}
  for (const field of rule.fields) {
    if (field.submit === false) continue
    const value = draft[field.dataIndex]
    if (field.type === 'day-age') {
      const normalized = dayAgeOf(value, field.title, field.required, field.maxAge)
      if (normalized !== undefined) payload[field.dataIndex] = normalized
    } else if (field.type === 'day-age-range') {
      const normalized = dayAgeRangeOf(value, field.title, field.required, field.maxAge, field.max)
      if (normalized) payload[field.dataIndex] = normalized
    } else if (field.type === 'number') {
      const normalized = finiteNumberOf(value, field.title, field.required, field.min, field.max)
      if (normalized !== undefined) payload[field.dataIndex] = normalized
    } else if (field.type === 'dict') {
      const values = field.multiple ? arrayOf(value, field.title, field.required) : undefined
      if (field.multiple) {
        if (values!.length) payload[field.dataIndex] = values
      } else {
        const normalized = textOf(value, field.title, field.required)
        if (normalized) payload[field.dataIndex] = normalized
      }
    } else if (field.type === 'supply') {
      const normalized = supplyIdOf(value, field.title, field.required)
      if (normalized !== undefined) payload[field.dataIndex] = normalized
    } else {
      const normalized = textOf(value, field.title, field.required, field.max)
      if (normalized) payload[field.dataIndex] = normalized
    }
  }

  const orderedRanges: Array<[string, string, string]> = [
    ['startDayAge', 'endDayAge', '结束日龄不能小于起始日龄'],
    ['minTemperatureCelsius', 'maxTemperatureCelsius', '最高温度不能小于最低温度'],
    ['minHumidityPercent', 'maxHumidityPercent', '最高湿度不能小于最低湿度'],
  ]
  for (const [from, to, message] of orderedRanges) {
    if (payload[from] !== undefined && payload[to] !== undefined && Number(payload[from]) > Number(payload[to])) throw new Error(message)
  }
  if (id !== undefined) payload.id = id
  return payload
}

function ventilationCellOf (value: unknown, label: string): { temperature: number; ventilationRate: number } {
  const cell = jsonObject(value, label)
  const temperature = finiteNumberOf(cell.temperature, `${label}.temperature`, true)!
  const ventilationRate = finiteNumberOf(cell.ventilationRate, `${label}.ventilationRate`, true, 0)
  if (ventilationRate === undefined || ventilationRate <= 0) throw new Error(`${label}.ventilationRate必须是大于0的数字`)
  return { temperature, ventilationRate }
}

function ventilationPayloadOf (input: unknown, requireOriginalDayAge: boolean): Record<string, unknown> {
  const row = jsonObject(input, '通风程序矩阵行')
  const dayAge = dayAgeOf(row.dayAge, '日龄', true)
  const frequencyCode = textOf(row.frequencyCode, '执行频次', true)
  if (!Array.isArray(row.cells)) throw new Error('cells必须是数组')
  const cells = row.cells.filter(cell => {
    if (cell === null || typeof cell !== 'object') return false
    const value = (cell as Record<string, unknown>).ventilationRate
    return value !== undefined && value !== null && value !== ''
  }).map((cell, index) => ventilationCellOf(cell, `cells[${index}]`))
  if (!cells.length) throw new Error('至少填写一个温度对应的通风率')
  const temperatures = new Set<number>()
  for (const cell of cells) {
    if (temperatures.has(cell.temperature)) throw new Error('温度不能重复')
    temperatures.add(cell.temperature)
  }
  const payload: Record<string, unknown> = { dayAge, frequencyCode, cells }
  const remarkValue = textOf(row.remark, '备注', false, 500)
  if (remarkValue) payload.remark = remarkValue
  const originalDayAge = row.originalDayAge ?? row._originalDayAge
  if (requireOriginalDayAge) payload.originalDayAge = dayAgeOf(originalDayAge, 'originalDayAge', true)
  return payload
}

function payloadOf (result: unknown): unknown {
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    const object = result as Record<string, unknown>
    if (object.data !== undefined && (object.list === undefined && object.records === undefined && object.items === undefined && object.rows === undefined)) return object.data
  }
  return result
}

function rowsOf (result: unknown, label: string): ProductProgramRow[] {
  const payload = payloadOf(result)
  if (payload === null || payload === undefined) return []
  if (Array.isArray(payload)) return payload.map((item, index) => rowOf(item, `${label}[${index}]`))
  const object = jsonObject(payload, label)
  const list = object.list ?? object.records ?? object.items
  if (!Array.isArray(list)) throw new Error(`${label}必须包含list数组`)
  return list.map((item, index) => rowOf(item, `${label}.list[${index}]`))
}

function rowOf (value: unknown, label: string): ProductProgramRow {
  const row = jsonObject(value, label)
  const id = row.id === undefined || row.id === null || row.id === '' ? null : idOf(row.id, `${label}.id`)
  return { ...row, ...(id === null ? { id: null } : { id }) }
}

function pageResultOf (result: unknown, label: string): ProductProgramPage {
  const payload = payloadOf(result)
  const object = jsonObject(payload, label)
  const list = object.list ?? object.records ?? object.items
  if (!Array.isArray(list)) throw new Error(`${label}必须包含list数组`)
  const rawTotal = object.total ?? object.count ?? list.length
  if (!Number.isSafeInteger(Number(rawTotal)) || Number(rawTotal) < 0) throw new Error(`${label}.total必须是非负整数`)
  return { list: list.map((item, index) => rowOf(item, `${label}.list[${index}]`)), total: Number(rawTotal) }
}

function tabsOf (result: unknown): ProductProgramTab[] {
  const payload = payloadOf(result)
  if (payload === null || payload === undefined) return []
  const list = Array.isArray(payload) ? payload : (() => {
    const object = jsonObject(payload, '程序库 Tab 响应')
    const value = object.list ?? object.tabs ?? object.data
    if (!Array.isArray(value)) throw new Error('程序库 Tab 响应必须是数组')
    return value
  })()
  return list.map((item, index) => {
    const tab = jsonObject(item, `程序库 Tab[${index}]`)
    if (typeof tab.code !== 'string' || tab.code.trim() === '') throw new Error(`程序库 Tab[${index}].code不能为空`)
    if (typeof tab.name !== 'string') throw new Error(`程序库 Tab[${index}].name必须是字符串`)
    const children = tab.children === undefined || tab.children === null ? [] : tab.children
    if (!Array.isArray(children)) throw new Error(`程序库 Tab[${index}].children必须是数组`)
    return { ...tab, code: tab.code, name: tab.name, children: children.map((child, childIndex) => {
      const item = jsonObject(child, `程序库 Tab[${index}].children[${childIndex}]`)
      if (typeof item.code !== 'string' || item.code.trim() === '') throw new Error(`程序库 Tab[${index}].children[${childIndex}].code不能为空`)
      if (typeof item.name !== 'string') throw new Error(`程序库 Tab[${index}].children[${childIndex}].name必须是字符串`)
      return { ...item, code: item.code, name: item.name, children: [] }
    }) }
  })
}

function supplyItemsOf (result: unknown, label: string): ProductProgramSupplyItem[] {
  return rowsOf(result, label).filter(item => String(item.status) === '1' && item.id !== null).map(item => item as ProductProgramSupplyItem)
}

async function fetchAllSupply (request: PortalRequest, apiPath: string, label: string): Promise<ProductProgramSupplyItem[]> {
  const items = new Map<string, ProductProgramSupplyItem>()
  for (let pageNo = 1; pageNo <= 100; pageNo += 1) {
    const result = await request({ url: apiPath, method: 'get', params: { pageNo, pageSize: SUPPLY_PAGE_SIZE, status: 1 } })
    const pageItems = supplyItemsOf(result, label)
    for (const item of pageItems) items.set(String(item.id), item)
    const payload = payloadOf(result)
    const total = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? Number((payload as Record<string, unknown>).total ?? (payload as Record<string, unknown>).count ?? 0)
      : 0
    if (pageItems.length === 0 || items.size >= total || pageItems.length < SUPPLY_PAGE_SIZE) break
  }
  return [...items.values()]
}

function pageParamsOf (query: ProductProgramQuery): Record<string, unknown> {
  const rule = pageRuleOf(query.pageKey)
  const pageNo = query.pageNo ?? 1
  const pageSize = query.pageSize ?? 20
  if (!Number.isSafeInteger(pageNo) || pageNo < 1) throw new Error('pageNo必须为正整数')
  if (!Number.isSafeInteger(pageSize) || ![10, 20, 50].includes(pageSize)) throw new Error('pageSize必须是10、20或50')
  const filters = query.filters ?? {}
  const params: Record<string, unknown> = { pageNo, pageSize }
  for (const key of rule.filters) {
    const value = filters[key]
    if (value !== undefined && value !== null && value !== '') params[key] = value
  }
  for (const key of Object.keys(filters)) {
    if (!rule.filters.includes(key)) throw new Error(`${query.pageKey}不支持筛选字段${key}`)
  }
  return params
}

function fileInputOf (input: unknown): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = jsonObject(input, '程序库导入文件')
  if (typeof value.fileName !== 'string' || !/\.xlsx$/i.test(value.fileName)) throw new Error('fileName必须是xlsx文件；Portal导入控件只接受.xlsx')
  if (typeof value.base64 !== 'string' || value.base64.trim() === '') throw new Error('base64不能为空')
  const base64 = value.base64.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('导入文件不能为空')
  const contentType = typeof value.contentType === 'string' && value.contentType.trim() ? value.contentType : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName: value.fileName, contentType, bytes: new Uint8Array(bytes) }
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): ProductProgramFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('程序库导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentTypeValue = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  const disposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const dispositionText = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(dispositionText)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(dispositionText)?.[1]
  let fileName = fallback
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else if (plain) fileName = plain
  return {
    fileName,
    contentType: typeof contentTypeValue === 'string' && contentTypeValue ? contentTypeValue : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function idListOf (value: unknown): ProductProgramId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('ids必须是非空ID数组')
  return value.map((item, index) => idOf(item, `ids[${index}]`))
}

function programCodeOf (input: ProductProgramTemplateInput): string {
  const rule = pageRuleOf(input?.pageKey)
  const code = input.programCode ?? rule.code
  if (typeof code !== 'string' || code.trim() === '') throw new Error('programCode不能为空')
  return code.trim()
}

/** The injected request must use the page path that owns the mounted component. */
export function createProductProgramLibraryCapability (request: PortalRequest) {
  return {
    async tabs (): Promise<ProductProgramTab[]> {
      return tabsOf(await request({ url: `${PROGRAM_LIBRARY_API}/tabs`, method: 'get' }))
    },

    async list (query: ProductProgramQuery): Promise<ProductProgramPage> {
      const rule = pageRuleOf(query?.pageKey)
      if (query.pageKey === 'tongfeng') {
        const payload = jsonObject(payloadOf(await request({ url: `${rule.apiPath}/matrix`, method: 'get' })), '通风程序矩阵响应')
        const rows = Array.isArray(payload.rows) ? payload.rows.map((item, index) => rowOf(item, `通风程序矩阵.rows[${index}]`)) : []
        const temperatures = Array.isArray(payload.temperatures) ? payload.temperatures.map(Number).filter(Number.isFinite) : []
        return { list: rows, total: rows.length, temperatures }
      }
      return pageResultOf(await request({ url: `${rule.apiPath}/page`, method: 'get', params: pageParamsOf(query) }), `${rule.label}分页响应`)
    },

    async suppliers (): Promise<ProductProgramSupplyItem[]> {
      return fetchAllSupply(request, '/supply/supplier/page', '程序库厂家分页响应')
    },

    async materials (): Promise<ProductProgramSupplyItem[]> {
      return fetchAllSupply(request, '/supply/materiel/page', '程序库物料分页响应')
    },

    prepareCreate (input: ProductProgramPrepareInput): { draft: Record<string, unknown> } {
      return { draft: validateDraft(input?.pageKey, input?.draft, false) }
    },

    async create (input: ProductProgramPrepareInput): Promise<ProductProgramId> {
      const rule = pageRuleOf(input?.pageKey)
      const draft = validateDraft(input.pageKey, input.draft, false)
      const result = await request({ url: `${rule.apiPath}/create`, method: 'post', data: draft })
      return idOf(result, `${rule.label}创建响应ID`)
    },

    prepareUpdate (input: ProductProgramPrepareInput): { draft: Record<string, unknown> } {
      return { draft: validateDraft(input?.pageKey, input?.draft, true) }
    },

    async update (input: ProductProgramPrepareInput): Promise<true> {
      const rule = pageRuleOf(input?.pageKey)
      const draft = validateDraft(input.pageKey, input.draft, true)
      await request({ url: `${rule.apiPath}/update`, method: 'put', data: draft })
      return true
    },

    async remove (input: ProductProgramRemoveInput): Promise<true> {
      const rule = pageRuleOf(input?.pageKey)
      if (input.pageKey === 'tongfeng') throw new Error('通风程序请调用removeVentilation')
      await request({ url: `${rule.apiPath}/delete`, method: 'delete', params: { id: idOf(input.id, '程序记录ID') } })
      return true
    },

    async removeBatch (input: ProductProgramBatchRemoveInput): Promise<true> {
      const rule = pageRuleOf(input?.pageKey)
      if (!rule.supportsBatchDelete) throw new Error(`${rule.label}页面没有批量删除接口；请逐条调用remove`)
      if (input.pageKey === 'tongfeng') throw new Error('通风程序请调用removeVentilation')
      await request({ url: `${rule.apiPath}/delete-list`, method: 'delete', params: { ids: idListOf(input.ids) }, paramsArrayFormat: 'repeat' })
      return true
    },

    prepareVentilation (input: ProductProgramVentilationInput): { draft: Record<string, unknown> } {
      return { draft: ventilationPayloadOf(input?.row, false) }
    },

    async createVentilation (input: ProductProgramVentilationInput): Promise<true> {
      await request({ url: `${'/flockSimu/rearingPlan'}/ventilation/matrix/row`, method: 'post', data: ventilationPayloadOf(input?.row, false) })
      return true
    },

    async updateVentilation (input: ProductProgramVentilationInput): Promise<true> {
      await request({ url: `${'/flockSimu/rearingPlan'}/ventilation/matrix/row`, method: 'put', data: ventilationPayloadOf(input?.row, true) })
      return true
    },

    async removeVentilation (input: { dayAge: unknown }): Promise<true> {
      const dayAge = dayAgeOf(input?.dayAge, 'dayAge', true)
      await request({ url: `${'/flockSimu/rearingPlan'}/ventilation/matrix/row`, method: 'delete', params: { dayAge } })
      return true
    },

    async export (query: ProductProgramQuery): Promise<ProductProgramFile> {
      const rule = pageRuleOf(query?.pageKey)
      const params = query.pageKey === 'tongfeng' ? {} : pageParamsOf(query)
      delete params.pageNo
      delete params.pageSize
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${rule.apiPath}/export-excel`, method: 'get', params, responseType: 'arraybuffer' }), `${rule.label}.xls`)
    },

    async downloadTemplate (input: ProductProgramTemplateInput): Promise<ProductProgramFile> {
      const rule = pageRuleOf(input?.pageKey)
      const code = programCodeOf(input)
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${PROGRAM_LIBRARY_API}/import-template`, method: 'get', params: { programCode: code }, responseType: 'arraybuffer' }), `${rule.label}模板.xlsx`)
    },

    prepareImport (input: ProductProgramFileInput): { fileName: string; contentType: string; byteLength: number; maxRows: number } {
      const file = fileInputOf(input)
      return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength, maxRows: IMPORT_MAX_ROWS }
    },

    async importFile (input: ProductProgramFileInput & { pageKey: ProductProgramPageKey }): Promise<number> {
      const rule = pageRuleOf(input?.pageKey)
      const file = fileInputOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request({ url: `${rule.apiPath}/import-excel`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
      if (!Number.isSafeInteger(Number(result)) || Number(result) < 0) throw new Error(`${rule.label}导入响应必须是非负整数`) 
      return Number(result)
    },
  }
}

export type ProductProgramLibraryCapability = ReturnType<typeof createProductProgramLibraryCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const pageKeyParam: ParamSpec = { ...p('pageKey', 'enum', true, '程序子页键；先用tabs返回的children.code映射，静态键为mianyi/touyao/xiaodu/kangti/weisheng/poujie/siliao-jiance/yaomin/tingzhen/guangzhao/wendu/tongfeng/shujing/qingfen/kongchang/huanliao/dunsi'), options: PRODUCT_PROGRAM_PAGE_KEYS.map(value => ({ label: PRODUCT_PROGRAM_PAGE_RULES[value].label, value })) }
const queryParams: ParamSpec[] = [pageKeyParam, p('pageNo', 'number', false, '页码；非通风页默认1'), p('pageSize', 'number', false, '页面支持10、20、50；默认20'), p('filters', 'text', false, '仅允许当前pageKey的页面筛选字段；投药等页面的筛选字段见AI说明')]
const writeParams: ParamSpec[] = [pageKeyParam, p('draft', 'text', true, '当前程序子页的行草稿；字段、必填、类型、长度和跨字段范围按页面规则校验，prepare返回的draft可直接提交')]
const removeParams: ParamSpec[] = [pageKeyParam, p('id', 'text', true, '列表行id；删除请求按Portal发送为查询参数id')]
const fileParams: ParamSpec[] = [pageKeyParam, p('fileName', 'text', true, 'Portal导入控件只接受.xlsx文件名'), p('base64', 'text', true, 'xlsx文件的标准Base64内容'), p('contentType', 'text', false, '文件MIME类型；省略使用xlsx MIME')]

function definitionsFor (prefix: string, pagePath: string, permission: string, moduleType: number | null): CapabilityDefinition[] {
  const items: Array<{ suffix: string; title: string; write: boolean; params: ParamSpec[] }> = [
    { suffix: 'tabs', title: '读取程序库目录', write: false, params: [] },
    { suffix: 'list', title: '查询程序库记录', write: false, params: queryParams },
    { suffix: 'suppliers', title: '查询程序库厂家选项', write: false, params: [] },
    { suffix: 'materials', title: '查询程序库物料选项', write: false, params: [] },
    { suffix: 'prepare-create', title: '准备新建程序记录', write: false, params: writeParams },
    { suffix: 'create', title: '新建程序记录', write: true, params: writeParams },
    { suffix: 'prepare-update', title: '准备更新程序记录', write: false, params: writeParams },
    { suffix: 'update', title: '更新程序记录', write: true, params: writeParams },
    { suffix: 'remove', title: '删除程序记录', write: true, params: removeParams },
    { suffix: 'remove-batch', title: '批量删除程序记录', write: true, params: [pageKeyParam, p('ids', 'text', true, '仅支持光照、温湿度、输精、清粪、空舍、换料、顿饲页面；通风使用专用矩阵删除')] },
    { suffix: 'prepare-ventilation', title: '准备通风矩阵行', write: false, params: [p('row', 'text', true, '包含dayAge、frequencyCode、cells和可选remark；至少一个通风率大于0')] },
    { suffix: 'create-ventilation', title: '新建通风矩阵行', write: true, params: [p('row', 'text', true, '通风矩阵行；页面逐行POST到matrix/row')] },
    { suffix: 'update-ventilation', title: '更新通风矩阵行', write: true, params: [p('row', 'text', true, '通风矩阵行；必须保留原始日龄originalDayAge')] },
    { suffix: 'remove-ventilation', title: '删除通风矩阵行', write: true, params: [p('dayAge', 'number', true, '通风矩阵行日龄')] },
    { suffix: 'export', title: '导出程序库Excel', write: false, params: queryParams.slice(0, 1).concat(queryParams.slice(3)) },
    { suffix: 'download-template', title: '下载程序库导入模板', write: false, params: [pageKeyParam, p('programCode', 'text', false, '程序库二级Tab的code；省略时使用当前pageKey对应的静态编码')] },
    { suffix: 'prepare-import', title: '准备导入程序库Excel', write: false, params: fileParams.slice(1) },
    { suffix: 'import', title: '导入程序库Excel', write: true, params: fileParams },
  ]
  return items.map(item => ({ id: `${prefix}-${item.suffix}`, title: item.title, write: item.write, params: item.params, pagePath, permission, moduleType }))
}

export const PRODUCT_PROGRAM_LIBRARY_METHODS = {
  'product-program-library-tabs': 'tabs',
  'product-program-library-list': 'list',
  'product-program-library-suppliers': 'suppliers',
  'product-program-library-materials': 'materials',
  'product-program-library-prepare-create': 'prepareCreate',
  'product-program-library-create': 'create',
  'product-program-library-prepare-update': 'prepareUpdate',
  'product-program-library-update': 'update',
  'product-program-library-remove': 'remove',
  'product-program-library-remove-batch': 'removeBatch',
  'product-program-library-prepare-ventilation': 'prepareVentilation',
  'product-program-library-create-ventilation': 'createVentilation',
  'product-program-library-update-ventilation': 'updateVentilation',
  'product-program-library-remove-ventilation': 'removeVentilation',
  'product-program-library-export': 'export',
  'product-program-library-download-template': 'downloadTemplate',
  'product-program-library-prepare-import': 'prepareImport',
  'product-program-library-import': 'importFile',
} as const

export const PRODUCT_PROGRAM_LIBRARY_NEW_METHODS = Object.fromEntries(
  Object.entries(PRODUCT_PROGRAM_LIBRARY_METHODS).map(([id, method]) => [id.replace('product-program-library', 'product-program-library-new'), method]),
) as { [K in keyof typeof PRODUCT_PROGRAM_LIBRARY_METHODS as K extends `product-program-library${infer S}` ? `product-program-library-new${S}` : never]: typeof PRODUCT_PROGRAM_LIBRARY_METHODS[K] }

export const productProgramLibraryCapabilities = definitionsFor(
  'product-program-library', PRODUCT_PROGRAM_LIBRARY_PAGE_PATH, PRODUCT_PROGRAM_LIBRARY_PERMISSION, PRODUCT_PROGRAM_LIBRARY_MODULE_TYPE,
)
export const productProgramLibraryNewCapabilities = definitionsFor(
  'product-program-library-new', PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH, PRODUCT_PROGRAM_LIBRARY_NEW_PERMISSION, PRODUCT_PROGRAM_LIBRARY_NEW_MODULE_TYPE,
)
