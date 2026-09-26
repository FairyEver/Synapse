import { describe, expect, it } from 'vitest'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_SCHEDULE_JOB_ACTION_PERMISSION,
  SALE_SCHEDULE_JOB_MODULE_TYPE,
  SALE_SCHEDULE_JOB_PAGE_PATH,
  SALE_SCHEDULE_JOB_PERMISSION,
  createSaleScheduleJobCapability,
  saleScheduleJobCapabilities,
} from '../src/capabilities/sale-schedule-job.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/vue/job/scheduleJob/list') {
      return {
        list: [{
          id: 'row-1',
          jobId: 'job-1',
          jobName: '任务一',
          beanName: 'demoJob',
          methodName: 'run',
          params: '{}',
          cronExpression: '0 0 * * * ?',
          status: 0,
          createDate: '2026-09-24 10:00:00',
          updateDate: '2026-09-24 10:00:01',
          remarks: '备注',
        }],
        count: 1,
      } as T
    }
    return '操作成功' as T
  }
  return { api: createSaleScheduleJobCapability(request), calls }
}

const form = {
  jobId: 'job-1',
  jobName: '任务一',
  beanName: 'demoJob',
  methodName: 'run',
  params: '{}',
  cronExpression: '0 0 * * * ?',
  remarks: '备注',
}

describe('sale-schedule-job 任务管理', () => {
  it('能力绑定保留页面、动作权限、module-type和crm实例', () => {
    expect(saleScheduleJobCapabilities).toHaveLength(13)
    expect(saleScheduleJobCapabilities.every(item => item.pagePath === SALE_SCHEDULE_JOB_PAGE_PATH)).toBe(true)
    expect(saleScheduleJobCapabilities.every(item => item.permission === SALE_SCHEDULE_JOB_PERMISSION)).toBe(true)
    expect(saleScheduleJobCapabilities.every(item => item.moduleType === SALE_SCHEDULE_JOB_MODULE_TYPE)).toBe(true)
    expect(saleScheduleJobCapabilities.every(item => item.httpInstance === 'crm')).toBe(true)
    expect(SALE_SCHEDULE_JOB_ACTION_PERMISSION).toBe('job:scheduleJob:edit')

    const catalog = createCatalog({ capabilities: saleScheduleJobCapabilities })
    const described = catalog.describe('sale-schedule-job-list')
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

  it('列表按Portal发送公共排序字段、四个筛选值、页码和页大小，并把count映射为total', async () => {
    const { api, calls } = fixture()
    await expect(api.list()).resolves.toMatchObject({
      total: 1,
      list: [{ id: 'row-1', jobId: 'job-1', status: 0, cronExpression: '0 0 * * * ?' }],
    })
    expect(calls[0]).toMatchObject({
      url: '/vue/job/scheduleJob/list',
      method: 'get',
      params: { order: '', orderField: '', jobName: '', beanName: '', methodName: '', status: '', pageNo: 1, pageSize: 20 },
    })
    await expect(api.list({ order: 'asc', orderField: 'jobName', jobName: '任务', beanName: 'demo', methodName: 'run', status: 1, pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    expect(calls[1]?.params).toEqual({ order: 'asc', orderField: 'jobName', jobName: '任务', beanName: 'demo', methodName: 'run', status: 1, pageNo: 2, pageSize: 50 })
  })

  it('新建和编辑都提交页面完整表单、使用save接口和表单编码头', async () => {
    const { api, calls } = fixture()
    expect(api.prepareCreate({ form })).toEqual({ form })
    expect(calls).toHaveLength(0)
    await expect(api.create({ form })).resolves.toBeUndefined()
    expect(calls[0]).toMatchObject({
      url: '/vue/job/scheduleJob/save',
      method: 'post',
      data: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect((calls[0]?.data as Record<string, unknown>).status).toBeUndefined()

    const updateForm = { ...form, id: 'row-1', cronExpression: '0 5 * * * ?' }
    expect(api.prepareUpdate({ form: updateForm })).toEqual({ form: updateForm })
    await expect(api.update({ form: updateForm })).resolves.toBeUndefined()
    expect(calls[1]).toMatchObject({
      url: '/vue/job/scheduleJob/save',
      method: 'post',
      data: updateForm,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  })

  it('删除必须经过本地准备确认，按页面发送无请求体DELETE且不添加额外头', async () => {
    const { api, calls } = fixture()
    expect(api.prepareRemove({ id: 'row-1' })).toEqual({ id: 'row-1' })
    expect(calls).toHaveLength(0)
    await expect(api.remove({ id: 'row-1' })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({ url: '/vue/job/scheduleJob/row-1', method: 'delete' })
  })

  it('立即执行、暂停和恢复按页面的jobId、状态门禁和请求头发送POST', async () => {
    const { api, calls } = fixture()
    expect(api.prepareRun({ jobId: 'job-1' })).toEqual({ jobId: 'job-1' })
    await expect(api.run({ jobId: 'job-1' })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/vue/job/scheduleJob/run',
      method: 'post',
      data: null,
      params: { jobId: 'job-1' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    expect(api.preparePause({ jobId: 'job-1', currentStatus: 0 })).toEqual({ jobId: 'job-1', currentStatus: 0 })
    await expect(api.pause({ jobId: 'job-1', currentStatus: 0 })).resolves.toBeUndefined()
    expect(calls[1]).toMatchObject({ url: '/vue/job/scheduleJob/pause', method: 'post', data: null, params: { jobId: 'job-1' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(() => api.preparePause({ jobId: 'job-1', currentStatus: 1 })).toThrow('暂停')

    expect(api.prepareResume({ jobId: 'job-1', currentStatus: 1 })).toEqual({ jobId: 'job-1', currentStatus: 1 })
    await expect(api.resume({ jobId: 'job-1', currentStatus: 1 })).resolves.toBeUndefined()
    expect(calls[2]).toMatchObject({ url: '/vue/job/scheduleJob/resume', method: 'post', data: null, params: { jobId: 'job-1' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(() => api.prepareResume({ jobId: 'job-1', currentStatus: 0 })).toThrow('恢复')
  })

  it('坏输入和坏分页响应拒绝，不能伪造成功或空列表', async () => {
    const { api } = fixture()
    expect(() => api.prepareCreate({ form: { ...form, jobName: '' } })).toThrow('jobName')
    expect(() => api.prepareCreate({ form: { ...form, cronExpression: 'x'.repeat(101) } })).toThrow('cronExpression')
    expect(() => api.prepareUpdate({ form: form as never })).toThrow('任务管理ID')
    await expect(api.list({ status: 2 as never })).rejects.toThrow('status')
    expect(() => api.prepareRun({ jobId: ' ' })).toThrow('定时任务ID')
    const badApi = createSaleScheduleJobCapability(async () => ({ list: [], count: '1' } as never))
    await expect(badApi.list()).rejects.toThrow('有效count')
  })
})
