import { describe, expect, it } from 'vitest'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_SCHEDULE_JOB_LOG_ACTION_PERMISSION,
  SALE_SCHEDULE_JOB_LOG_MODULE_TYPE,
  SALE_SCHEDULE_JOB_LOG_PAGE_PATH,
  SALE_SCHEDULE_JOB_LOG_PERMISSION,
  createSaleScheduleJobLogCapability,
  saleScheduleJobLogCapabilities,
} from '../src/capabilities/sale-schedule-job-log.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/vue/job/scheduleJobLog/list') {
      return {
        list: [{
          id: 'log-1',
          jobId: 'job-1',
          beanName: 'demoJob',
          methodName: 'run',
          params: '{}',
          status: '10',
          times: 12,
          createDate: '2026-09-24 10:00:00',
          updateDate: '2026-09-24 10:00:01',
          error: null,
          remarks: '备注',
        }],
        count: 1,
      } as T
    }
    if (config.url === '/vue/job/scheduleJobLog/save') return '保存定时任务成功' as T
    if (config.url === '/vue/job/scheduleJobLog/log-1') return '删除定时任务日志成功' as T
    return undefined as T
  }
  return { api: createSaleScheduleJobLogCapability(request), calls }
}

const form = {
  jobId: 'job-1',
  beanName: 'demoJob',
  methodName: 'run',
  params: '{}',
  status: '10',
  times: 12,
  error: '',
  remarks: '备注',
}

describe('sale-schedule-job-log 任务日志', () => {
  it('能力绑定保留页面、动作权限、module-type和crm实例', () => {
    expect(saleScheduleJobLogCapabilities).toHaveLength(7)
    expect(saleScheduleJobLogCapabilities.every(item => item.pagePath === SALE_SCHEDULE_JOB_LOG_PAGE_PATH)).toBe(true)
    expect(saleScheduleJobLogCapabilities.every(item => item.permission === SALE_SCHEDULE_JOB_LOG_PERMISSION)).toBe(true)
    expect(saleScheduleJobLogCapabilities.every(item => item.moduleType === SALE_SCHEDULE_JOB_LOG_MODULE_TYPE)).toBe(true)
    expect(saleScheduleJobLogCapabilities.every(item => item.httpInstance === 'crm')).toBe(true)
    expect(SALE_SCHEDULE_JOB_LOG_ACTION_PERMISSION).toBe('job:scheduleJobLog:edit')

    const catalog = createCatalog({ capabilities: saleScheduleJobLogCapabilities })
    const described = catalog.describe('sale-schedule-job-log-list')
    expect(described.ok).toBe(true)
    if (described.ok) {
      expect(described.howToCall.entryPoints[0]?.httpInstance).toEqual({
        kind: 'resolved',
        id: 'crm',
        matchedBy: 'declared',
        baseUrlEnv: 'VITE_CRM_API',
      })
    }
  })

  it('列表按Portal发送公共排序字段、三个空筛选值、页码和页大小，并把count映射为total', async () => {
    const { api, calls } = fixture()
    await expect(api.list()).resolves.toMatchObject({
      total: 1,
      list: [{ id: 'log-1', jobId: 'job-1', status: '10', times: 12 }],
    })
    expect(calls[0]).toMatchObject({
      url: '/vue/job/scheduleJobLog/list',
      method: 'get',
      params: { order: '', orderField: '', beanName: '', methodName: '', status: '', pageNo: 1, pageSize: 20 },
    })
    await expect(api.list({ order: 'asc', orderField: 'createDate', beanName: 'demoJob', methodName: 'run', status: '10', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    expect(calls[1]?.params).toEqual({ order: 'asc', orderField: 'createDate', beanName: 'demoJob', methodName: 'run', status: '10', pageNo: 2, pageSize: 50 })
  })

  it('新建和编辑都提交完整表单、使用save接口和表单编码头', async () => {
    const { api, calls } = fixture()
    expect(api.prepareCreate({ form })).toEqual({ form })
    expect(calls).toHaveLength(0)
    await expect(api.create({ form })).resolves.toBeUndefined()
    expect(calls[0]).toMatchObject({
      url: '/vue/job/scheduleJobLog/save',
      method: 'post',
      data: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const updateForm = { ...form, id: 'log-1', times: 13 }
    expect(api.prepareUpdate({ form: updateForm })).toEqual({ form: updateForm })
    await expect(api.update({ form: updateForm })).resolves.toBeUndefined()
    expect(calls[1]).toMatchObject({
      url: '/vue/job/scheduleJobLog/save',
      method: 'post',
      data: updateForm,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  })

  it('删除必须经过本地准备确认，按页面发送无请求体DELETE且不添加额外头', async () => {
    const { api, calls } = fixture()
    expect(api.prepareRemove({ id: 'log-1' })).toEqual({ id: 'log-1' })
    expect(calls).toHaveLength(0)
    await expect(api.remove({ id: 'log-1' })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({ url: '/vue/job/scheduleJobLog/log-1', method: 'delete' })
  })

  it('坏输入和坏分页响应拒绝，不能伪造成功或空列表', async () => {
    const { api } = fixture()
    expect(() => api.prepareCreate({ form: { ...form, jobId: '' } })).toThrow('jobId')
    expect(() => api.prepareCreate({ form: { ...form, status: '12345' } })).toThrow('status')
    expect(() => api.prepareCreate({ form: { ...form, times: 1.5 } })).toThrow('times')
    expect(() => api.prepareUpdate({ form: form as never })).toThrow('任务日志ID')
    expect(() => api.prepareRemove({ id: '  ' })).toThrow('任务日志ID')
    const badApi = createSaleScheduleJobLogCapability(async () => ({ list: [], count: '1' } as never))
    await expect(badApi.list()).rejects.toThrow('有效count')
  })
})
