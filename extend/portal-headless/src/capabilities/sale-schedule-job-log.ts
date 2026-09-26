import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 任务管理 → 任务日志。 */
export const SALE_SCHEDULE_JOB_LOG_PAGE_PATH = '/dashboard/sale/job/schedule-job-log/list'
export const SALE_SCHEDULE_JOB_LOG_PERMISSION = '/dashboard/sale/frame/job/scheduleJobLog'
export const SALE_SCHEDULE_JOB_LOG_ACTION_PERMISSION = 'job:scheduleJobLog:edit'
export const SALE_SCHEDULE_JOB_LOG_MODULE_TYPE = 60

const ROOT = '/vue/job/scheduleJobLog'

export type SaleScheduleJobLogId = string | number
export type SaleScheduleJobLogRow = Record<string, unknown> & {
  id?: SaleScheduleJobLogId | null
  jobId?: string | null
  beanName?: string | null
  methodName?: string | null
  params?: string | null
  status?: string | null
  error?: string | null
  times?: number | null
  createDate?: string | number | null
  updateDate?: string | number | null
  remarks?: string | null
}
export type SaleScheduleJobLogQuery = {
  order?: string | null
  orderField?: string | null
  beanName?: string | null
  methodName?: string | null
  status?: string | null
  pageNo?: number
  pageSize?: number
}
export type SaleScheduleJobLogForm = {
  jobId: string
  beanName?: string | null
  methodName?: string | null
  params?: string | null
  status: string
  times: number
  error?: string | null
  remarks?: string | null
}
export type SaleScheduleJobLogUpdateForm = SaleScheduleJobLogForm & { id: SaleScheduleJobLogId }
export type SaleScheduleJobLogFormPreparation = { form: Record<string, unknown> }
export type SaleScheduleJobLogRemovePreparation = { id: SaleScheduleJobLogId }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleScheduleJobLogId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function textOf (value: unknown, label: string, options: { required?: boolean; max?: number } = {}): string {
  const { required = false, max } = options
  if (value === undefined || value === null) {
    if (!required) return ''
    throw new Error(`${label}必填`)
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (required && !value.trim()) throw new Error(`${label}必填且不能全为空格`)
  if (max !== undefined && value.length > max) throw new Error(`${label}长度不能超过${max}`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须是字符串、有限数字或null`)
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须是安全整数`)
  return value as number
}

function positiveIntegerOf (value: unknown, label: string): number {
  const result = integerOf(value, label)
  if (result < 1) throw new Error(`${label}必须为正整数`)
  return result
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(result)) {
    throw new Error('pageSize必须是10、20、50、100、200或500')
  }
  return result
}

function rowOf (value: unknown, label: string): SaleScheduleJobLogRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: row.id === undefined || row.id === null ? null : idOf(row.id, `${label}.id`),
    jobId: nullableTextOf(row.jobId, `${label}.jobId`),
    beanName: nullableTextOf(row.beanName, `${label}.beanName`),
    methodName: nullableTextOf(row.methodName, `${label}.methodName`),
    params: nullableTextOf(row.params, `${label}.params`),
    status: nullableTextOf(row.status, `${label}.status`),
    error: nullableTextOf(row.error, `${label}.error`),
    times: row.times === undefined || row.times === null ? null : integerOf(row.times, `${label}.times`),
    createDate: dateOf(row.createDate, `${label}.createDate`),
    updateDate: dateOf(row.updateDate, `${label}.updateDate`),
    remarks: nullableTextOf(row.remarks, `${label}.remarks`),
  }
}

function pageOf (value: unknown): PageResult<SaleScheduleJobLogRow> {
  const page = objectOf(value, '任务日志分页响应')
  if (!Array.isArray(page.list)) throw new Error('任务日志分页响应缺少list数组')
  if (!Number.isSafeInteger(page.count) || (page.count as number) < 0) throw new Error('任务日志分页响应缺少有效count')
  return {
    list: page.list.map((item, index) => rowOf(item, `任务日志列表[${index}]`)),
    total: page.count as number,
  }
}

function formOf (input: unknown, mode: 'create' | 'update'): Record<string, unknown> {
  const form = objectOf(input, '任务日志表单')
  const payload: Record<string, unknown> = {
    jobId: textOf(form.jobId, 'jobId', { required: true, max: 64 }),
    beanName: textOf(form.beanName, 'beanName', { max: 200 }),
    methodName: textOf(form.methodName, 'methodName', { max: 100 }),
    params: textOf(form.params, 'params', { max: 2000 }),
    status: textOf(form.status, 'status', { required: true, max: 4 }),
    times: positiveIntegerOf(form.times, 'times'),
    error: textOf(form.error, 'error', { max: 2000 }),
    remarks: textOf(form.remarks, 'remarks'),
  }
  if (mode === 'update') payload.id = idOf(form.id, '任务日志ID')
  return payload
}

/**
 * Portal 页面只用列表行打开详情弹窗，不调用后端详情 GET；因此这里仅暴露页面实际可达的动作。
 * 新建和编辑都提交 ModalFormContent 生成的完整表单，删除则只发送无请求体的 DELETE。
 */
export function createSaleScheduleJobLogCapability (request: PortalRequest) {
  return {
    async list (query: SaleScheduleJobLogQuery = {}): Promise<PageResult<SaleScheduleJobLogRow>> {
      return pageOf(await request({
        url: `${ROOT}/list`,
        method: 'get',
        params: {
          order: textOf(query.order, 'order'),
          orderField: textOf(query.orderField, 'orderField'),
          beanName: textOf(query.beanName, 'beanName'),
          methodName: textOf(query.methodName, 'methodName'),
          status: textOf(query.status, 'status'),
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
      }))
    },

    prepareCreate (input: { form: SaleScheduleJobLogForm }): SaleScheduleJobLogFormPreparation {
      return { form: formOf(input?.form, 'create') }
    },

    async create (input: { form: SaleScheduleJobLogForm }): Promise<void> {
      await request({
        url: `${ROOT}/save`,
        method: 'post',
        data: formOf(input?.form, 'create'),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    },

    prepareUpdate (input: { form: SaleScheduleJobLogUpdateForm }): SaleScheduleJobLogFormPreparation {
      return { form: formOf(input?.form, 'update') }
    },

    async update (input: { form: SaleScheduleJobLogUpdateForm }): Promise<void> {
      await request({
        url: `${ROOT}/save`,
        method: 'post',
        data: formOf(input?.form, 'update'),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    },

    prepareRemove (input: { id: SaleScheduleJobLogId }): SaleScheduleJobLogRemovePreparation {
      return { id: idOf(input?.id, '任务日志ID') }
    },

    async remove (input: { id: SaleScheduleJobLogId }): Promise<void> {
      await request({ url: `${ROOT}/${idOf(input?.id, '任务日志ID')}`, method: 'delete' })
    },
  }
}

export type SaleScheduleJobLogCapability = ReturnType<typeof createSaleScheduleJobLogCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })

const formParam = p('form', 'text', true, 'Portal任务日志弹窗的完整表单对象；新建不带id，编辑必须带当前行id')

export const SALE_SCHEDULE_JOB_LOG_METHODS = {
  'sale-schedule-job-log-list': 'list',
  'sale-schedule-job-log-prepare-create': 'prepareCreate',
  'sale-schedule-job-log-create': 'create',
  'sale-schedule-job-log-prepare-update': 'prepareUpdate',
  'sale-schedule-job-log-update': 'update',
  'sale-schedule-job-log-prepare-remove': 'prepareRemove',
  'sale-schedule-job-log-remove': 'remove',
} as const

export const saleScheduleJobLogCapabilities: CapabilityDefinition[] = [
  { id: 'sale-schedule-job-log-list', title: '查询任务日志', write: false, params: [p('order', 'text', false, 'Portal公共列表排序值；页面默认空字符串且没有排序控件'), p('orderField', 'text', false, 'Portal公共列表排序字段；页面默认空字符串且没有排序控件'), p('beanName', 'text', false, 'Bean名称精确筛选'), p('methodName', 'text', false, '方法名精确筛选'), p('status', 'text', false, 'execute_status字典值筛选'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-schedule-job-log-prepare-create', title: '准备新建任务日志', write: false, params: [formParam] },
  { id: 'sale-schedule-job-log-create', title: '新建任务日志', write: true, params: [formParam] },
  { id: 'sale-schedule-job-log-prepare-update', title: '准备编辑任务日志', write: false, params: [formParam] },
  { id: 'sale-schedule-job-log-update', title: '编辑任务日志', write: true, params: [formParam] },
  { id: 'sale-schedule-job-log-prepare-remove', title: '准备删除任务日志', write: false, params: [p('id', 'text', true, '从当前列表记录取得的任务日志ID')] },
  { id: 'sale-schedule-job-log-remove', title: '删除任务日志', write: true, params: [p('id', 'text', true, '当前列表记录的任务日志ID')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_SCHEDULE_JOB_LOG_PAGE_PATH,
  permission: SALE_SCHEDULE_JOB_LOG_PERMISSION,
  moduleType: SALE_SCHEDULE_JOB_LOG_MODULE_TYPE,
  httpInstance: 'crm',
}))
