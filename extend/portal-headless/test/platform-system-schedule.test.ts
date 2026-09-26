import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import { buildPlatformSystemSchedulePayload, createPlatformSystemScheduleCapability, PLATFORM_SYSTEM_SCHEDULE_MODULE_TYPE, PLATFORM_SYSTEM_SCHEDULE_PAGE_PATH, PLATFORM_SYSTEM_SCHEDULE_PERMISSION, platformSystemScheduleCapabilities } from '../src/capabilities/platform-system-schedule.js'
type RequestConfig = Parameters<PortalRequest>[0]
function setup (...results: unknown[]) { const calls: RequestConfig[] = []; const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => { calls.push(config); return results.shift() as T }; return { api: createPlatformSystemScheduleCapability(request), calls } }
const page = { list: [{ id: '9007199254740993', beanName: 'orderJob', params: '{}', cronExpression: '0 * * * * ?', status: 1, remark: null, createDate: '2026-09-23 10:00:00' }], total: 1 }
const form = { id: '9007199254740993', beanName: 'orderJob', params: '{}', cronExpression: '0 0 * * * ?', status: 0, remark: '暂停订单任务', createDate: '2026-09-23 10:00:00', extra: 'keep' }
describe('Portal 平台设置 → 定时任务页面能力', () => {
  it('锁定页面、权限、platform实例、无module-type和未启用styleV2的分页默认值', async () => {
    const { api, calls } = setup(page)
    await expect(api.list()).resolves.toEqual(page)
    expect(calls[0]).toEqual({ url: '/mall-manage-api/sys/schedule/page', method: 'get', params: { order: '', orderField: '', pageNo: 1, pageSize: 10 } })
    expect(platformSystemScheduleCapabilities.every(item => item.pagePath === PLATFORM_SYSTEM_SCHEDULE_PAGE_PATH)).toBe(true)
    expect(platformSystemScheduleCapabilities.every(item => item.permission === PLATFORM_SYSTEM_SCHEDULE_PERMISSION)).toBe(true)
    expect(platformSystemScheduleCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(platformSystemScheduleCapabilities.every(item => item.moduleType === PLATFORM_SYSTEM_SCHEDULE_MODULE_TYPE)).toBe(true)
  })
  it('编辑按页面bridge整表单POST update，run使用idList单值参数', async () => {
    const { api, calls } = setup('保存成功', '执行成功')
    expect(buildPlatformSystemSchedulePayload(form)).toEqual(form)
    expect(api.prepareUpdate({ form })).toEqual({ payload: form })
    await api.update({ form })
    expect(api.prepareRun({ id: form.id })).toEqual({ id: form.id })
    await api.run({ id: form.id })
    expect(calls).toEqual([
      { url: '/mall-manage-api/sys/schedule/update', method: 'post', data: form },
      { url: '/mall-manage-api/sys/schedule/run', method: 'get', params: { idList: form.id } },
    ])
  })
  it('只发布页面可达编辑和执行，不伪造详情/新建/删除/暂停能力', () => {
    expect(platformSystemScheduleCapabilities.map(item => item.id)).toEqual([
      'platform-system-schedule-list', 'platform-system-schedule-prepare-update', 'platform-system-schedule-update', 'platform-system-schedule-prepare-run', 'platform-system-schedule-run',
    ])
  })
  it('cron、ID、状态负例在请求前失败', async () => {
    const { api, calls } = setup()
    await expect(api.update({ form: { ...form, id: 0 } })).rejects.toThrow('正整数')
    await expect(api.update({ form: { ...form, cronExpression: '' } })).rejects.toThrow('规则')
    await expect(api.update({ form: { ...form, status: 2 } })).rejects.toThrow('status必须为0或1')
    const malformed = setup({ list: [], total: -1 })
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    expect(calls).toEqual([])
  })
})
