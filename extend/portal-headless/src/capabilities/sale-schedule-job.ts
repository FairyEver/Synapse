import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 任务管理。 */
export const SALE_SCHEDULE_JOB_PAGE_PATH = '/dashboard/sale/job/schedule-job/list'
export const SALE_SCHEDULE_JOB_PERMISSION = '/dashboard/sale/frame/job/scheduleJob'
export const SALE_SCHEDULE_JOB_ACTION_PERMISSION = 'job:scheduleJob:edit'
export const SALE_SCHEDULE_JOB_MODULE_TYPE = 60

const ROOT = '/vue/job/scheduleJob'
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' }

export type SaleScheduleJobId = string | number
export type SaleScheduleJobStatus = 0 | 1
export type SaleScheduleJobStatusFilter = '' | '0' | '1' | 0 | 1
export type SaleScheduleJobRow = Record<string, unknown> & {
  id?: SaleScheduleJobId | null
  jobId?: string | null
  jobName?: string | null
  beanName?: string | null
  methodName?: string | null
  params?: string | null
  cronExpression?: string | null
  status?: number | null
  createDate?: string | number | null
  updateDate?: string | number | null
  remarks?: string | null
}
export type SaleScheduleJobQuery = {
  order?: string | null
  orderField?: string | null
  jobName?: string | null
  beanName?: string | null
  methodName?: string | null
  status?: SaleScheduleJobStatusFilter | null
  pageNo?: number
  pageSize?: number
}
export type SaleScheduleJobForm = {
  jobId: string
  jobName: string
  beanName: string
  methodName: string
  params?: string | null
  cronExpression: string
  remarks?: string | null
}
export type SaleScheduleJobUpdateForm = SaleScheduleJobForm & { id: SaleScheduleJobId }
export type SaleScheduleJobFormPreparation = { form: Record<string, unknown> }
export type SaleScheduleJobRemovePreparation = { id: SaleScheduleJobId }
export type SaleScheduleJobRunPreparation = { jobId: SaleScheduleJobId }
export type SaleScheduleJobStatusPreparation = { jobId: SaleScheduleJobId; currentStatus: SaleScheduleJobStatus }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleScheduleJobId {
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

function statusOf (value: unknown, label: string): SaleScheduleJobStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（正常）或1（暂停）`)
  return value
}

function statusFilterOf (value: unknown): SaleScheduleJobStatusFilter {
  if (value === undefined || value === null || value === '') return ''
  if (value === 0 || value === 1 || value === '0' || value === '1') return value
  throw new Error('status只能是空字符串、0或1')
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(result)) {
    throw new Error('pageSize必须是10、20、50、100、200或500')
  }
  return result
}

function rowOf (value: unknown, label: string): SaleScheduleJobRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: row.id === undefined || row.id === null ? null : idOf(row.id, `${label}.id`),
    jobId: nullableTextOf(row.jobId, `${label}.jobId`),
    jobName: nullableTextOf(row.jobName, `${label}.jobName`),
    beanName: nullableTextOf(row.beanName, `${label}.beanName`),
    methodName: nullableTextOf(row.methodName, `${label}.methodName`),
    params: nullableTextOf(row.params, `${label}.params`),
    cronExpression: nullableTextOf(row.cronExpression, `${label}.cronExpression`),
    status: row.status === undefined || row.status === null ? null : integerOf(row.status, `${label}.status`),
    createDate: dateOf(row.createDate, `${label}.createDate`),
    updateDate: dateOf(row.updateDate, `${label}.updateDate`),
    remarks: nullableTextOf(row.remarks, `${label}.remarks`),
  }
}

function pageOf (value: unknown): PageResult<SaleScheduleJobRow> {
  const page = objectOf(value, '任务管理分页响应')
  if (!Array.isArray(page.list)) throw new Error('任务管理分页响应缺少list数组')
  if (!Number.isSafeInteger(page.count) || (page.count as number) < 0) throw new Error('任务管理分页响应缺少有效count')
  return {
    list: page.list.map((item, index) => rowOf(item, `任务管理列表[${index}]`)),
    total: page.count as number,
  }
}

function formOf (input: unknown, mode: 'create' | 'update'): Record<string, unknown> {
  const form = objectOf(input, '任务管理表单')
  const payload: Record<string, unknown> = {
    jobId: textOf(form.jobId, 'jobId', { required: true, max: 64 }),
    jobName: textOf(form.jobName, 'jobName', { required: true, max: 64 }),
    beanName: textOf(form.beanName, 'beanName', { required: true, max: 200 }),
    methodName: textOf(form.methodName, 'methodName', { required: true, max: 100 }),
    params: textOf(form.params, 'params', { max: 2000 }),
    cronExpression: textOf(form.cronExpression, 'cronExpression', { required: true, max: 100 }),
    remarks: textOf(form.remarks, 'remarks', { max: 2000 }),
  }
  if (mode === 'update') payload.id = idOf(form.id, '任务管理ID')
  return payload
}

function statusPreparationOf (input: unknown, expected: SaleScheduleJobStatus): SaleScheduleJobStatusPreparation {
  const value = objectOf(input, '任务管理状态操作')
  const jobId = idOf(value.jobId, '定时任务ID')
  const currentStatus = statusOf(value.currentStatus, '当前任务状态')
  if (currentStatus !== expected) {
    const action = expected === 0 ? '暂停' : '恢复'
    throw new Error(`${action}只能处理当前状态为${expected}的任务`)
  }
  return { jobId, currentStatus }
}

function actionRequest (request: PortalRequest, path: 'run' | 'pause' | 'resume', jobId: unknown): Promise<unknown> {
  return request({
    url: `${ROOT}/${path}`,
    method: 'post',
    data: null,
    params: { jobId: idOf(jobId, '定时任务ID') },
    headers: FORM_HEADERS,
  })
}

/**
 * Portal 页面只暴露当前列表上的保存、删除、立即开始、暂停和恢复；不暴露后端虽存在的详情与同步接口。
 * 新建和编辑都提交页面弹窗产生的完整表单，状态动作只传当前列表行的jobId。
 */
export function createSaleScheduleJobCapability (request: PortalRequest) {
  return {
    async list (query: SaleScheduleJobQuery = {}): Promise<PageResult<SaleScheduleJobRow>> {
      return pageOf(await request({
        url: `${ROOT}/list`,
        method: 'get',
        params: {
          order: textOf(query.order, 'order'),
          orderField: textOf(query.orderField, 'orderField'),
          jobName: textOf(query.jobName, 'jobName'),
          beanName: textOf(query.beanName, 'beanName'),
          methodName: textOf(query.methodName, 'methodName'),
          status: statusFilterOf(query.status),
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
      }))
    },

    prepareCreate (input: { form: SaleScheduleJobForm }): SaleScheduleJobFormPreparation {
      return { form: formOf(input?.form, 'create') }
    },

    async create (input: { form: SaleScheduleJobForm }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: formOf(input?.form, 'create'), headers: FORM_HEADERS })
    },

    prepareUpdate (input: { form: SaleScheduleJobUpdateForm }): SaleScheduleJobFormPreparation {
      return { form: formOf(input?.form, 'update') }
    },

    async update (input: { form: SaleScheduleJobUpdateForm }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: formOf(input?.form, 'update'), headers: FORM_HEADERS })
    },

    prepareRemove (input: { id: SaleScheduleJobId }): SaleScheduleJobRemovePreparation {
      return { id: idOf(input?.id, '任务管理ID') }
    },

    async remove (input: { id: SaleScheduleJobId }): Promise<void> {
      await request({ url: `${ROOT}/${idOf(input?.id, '任务管理ID')}`, method: 'delete' })
    },

    prepareRun (input: { jobId: SaleScheduleJobId }): SaleScheduleJobRunPreparation {
      return { jobId: idOf(input?.jobId, '定时任务ID') }
    },

    async run (input: { jobId: SaleScheduleJobId }): Promise<void> {
      await actionRequest(request, 'run', input?.jobId)
    },

    preparePause (input: { jobId: SaleScheduleJobId; currentStatus: SaleScheduleJobStatus }): SaleScheduleJobStatusPreparation {
      return statusPreparationOf(input, 0)
    },

    async pause (input: { jobId: SaleScheduleJobId; currentStatus: SaleScheduleJobStatus }): Promise<void> {
      const draft = statusPreparationOf(input, 0)
      await actionRequest(request, 'pause', draft.jobId)
    },

    prepareResume (input: { jobId: SaleScheduleJobId; currentStatus: SaleScheduleJobStatus }): SaleScheduleJobStatusPreparation {
      return statusPreparationOf(input, 1)
    },

    async resume (input: { jobId: SaleScheduleJobId; currentStatus: SaleScheduleJobStatus }): Promise<void> {
      const draft = statusPreparationOf(input, 1)
      await actionRequest(request, 'resume', draft.jobId)
    },
  }
}

export type SaleScheduleJobCapability = ReturnType<typeof createSaleScheduleJobCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'Portal任务管理弹窗的完整表单对象；编辑必须带当前行id，表单不包含status')
const idParam = p('id', 'text', true, '当前列表记录的任务管理ID')
const jobIdParam = p('jobId', 'text', true, '当前列表记录的定时任务ID，用于执行、暂停或恢复')
const currentStatusParam = { ...p('currentStatus', 'enum', true, '当前列表行状态；0正常、1暂停'), options: [{ label: '正常', value: 0 }, { label: '暂停', value: 1 }] }

export const SALE_SCHEDULE_JOB_METHODS = {
  'sale-schedule-job-list': 'list',
  'sale-schedule-job-prepare-create': 'prepareCreate',
  'sale-schedule-job-create': 'create',
  'sale-schedule-job-prepare-update': 'prepareUpdate',
  'sale-schedule-job-update': 'update',
  'sale-schedule-job-prepare-remove': 'prepareRemove',
  'sale-schedule-job-remove': 'remove',
  'sale-schedule-job-prepare-run': 'prepareRun',
  'sale-schedule-job-run': 'run',
  'sale-schedule-job-prepare-pause': 'preparePause',
  'sale-schedule-job-pause': 'pause',
  'sale-schedule-job-prepare-resume': 'prepareResume',
  'sale-schedule-job-resume': 'resume',
} as const

export const saleScheduleJobCapabilities: CapabilityDefinition[] = [
  { id: 'sale-schedule-job-list', title: '查询任务管理', write: false, params: [p('order', 'text', false, 'Portal公共列表排序值；页面默认空字符串且没有排序控件'), p('orderField', 'text', false, 'Portal公共列表排序字段；页面默认空字符串且没有排序控件'), p('jobName', 'text', false, '任务名称模糊筛选'), p('beanName', 'text', false, 'Spring Bean名称模糊筛选'), p('methodName', 'text', false, '方法名模糊筛选'), { ...p('status', 'enum', false, '任务状态；空字符串不筛选，0正常、1暂停'), options: [{ label: '正常', value: 0 }, { label: '暂停', value: 1 }] }, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-schedule-job-prepare-create', title: '准备新建定时任务', write: false, params: [formParam] },
  { id: 'sale-schedule-job-create', title: '新建定时任务', write: true, params: [formParam] },
  { id: 'sale-schedule-job-prepare-update', title: '准备编辑定时任务', write: false, params: [formParam] },
  { id: 'sale-schedule-job-update', title: '编辑定时任务', write: true, params: [formParam] },
  { id: 'sale-schedule-job-prepare-remove', title: '准备删除定时任务', write: false, params: [idParam] },
  { id: 'sale-schedule-job-remove', title: '删除定时任务', write: true, params: [idParam] },
  { id: 'sale-schedule-job-prepare-run', title: '准备立即执行定时任务', write: false, params: [jobIdParam] },
  { id: 'sale-schedule-job-run', title: '立即执行定时任务', write: true, params: [jobIdParam] },
  { id: 'sale-schedule-job-prepare-pause', title: '准备暂停定时任务', write: false, params: [jobIdParam, currentStatusParam] },
  { id: 'sale-schedule-job-pause', title: '暂停定时任务', write: true, params: [jobIdParam, currentStatusParam] },
  { id: 'sale-schedule-job-prepare-resume', title: '准备恢复定时任务', write: false, params: [jobIdParam, currentStatusParam] },
  { id: 'sale-schedule-job-resume', title: '恢复定时任务', write: true, params: [jobIdParam, currentStatusParam] },
].map(definition => ({
  ...definition,
  pagePath: SALE_SCHEDULE_JOB_PAGE_PATH,
  permission: SALE_SCHEDULE_JOB_PERMISSION,
  moduleType: SALE_SCHEDULE_JOB_MODULE_TYPE,
  httpInstance: 'crm',
}))
