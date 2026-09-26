import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import {
  createPlatformSystemQueueFailedCapability,
  PLATFORM_SYSTEM_QUEUE_FAILED_MODULE_TYPE,
  PLATFORM_SYSTEM_QUEUE_FAILED_PAGE_PATH,
  PLATFORM_SYSTEM_QUEUE_FAILED_PERMISSION,
  platformSystemQueueFailedCapabilities,
} from '../src/capabilities/platform-system-queue-failed.js'

type RequestConfig = Parameters<PortalRequest>[0]
function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => { calls.push(config); return results.shift() as T }
  return { api: createPlatformSystemQueueFailedCapability(request), calls }
}
const page = { list: [{ id: '9007199254740993', queueName: 'mail', data: '{"id":1}', createTime: 1720000000, reason: '连接失败' }], total: 1 }

describe('Portal 平台设置 → 失败队列页面能力', () => {
  it('锁定页面、权限、platform实例、无module-type和data分页参数', async () => {
    const { api, calls } = setup(page)
    await expect(api.list()).resolves.toEqual(page)
    expect(calls[0]).toEqual({ url: '/mall-manage-api/sys/queueFailed/page', method: 'get', params: { order: '', orderField: '', data: '', pageNo: 1, pageSize: 20 } })
    expect(platformSystemQueueFailedCapabilities.every(item => item.pagePath === PLATFORM_SYSTEM_QUEUE_FAILED_PAGE_PATH)).toBe(true)
    expect(platformSystemQueueFailedCapabilities.every(item => item.permission === PLATFORM_SYSTEM_QUEUE_FAILED_PERMISSION)).toBe(true)
    expect(platformSystemQueueFailedCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(platformSystemQueueFailedCapabilities.every(item => item.moduleType === PLATFORM_SYSTEM_QUEUE_FAILED_MODULE_TYPE)).toBe(true)
  })

  it('保留data原值、批量删除使用ID数组，手动执行把id拼进URL', async () => {
    const { api, calls } = setup(page, '删除成功', '执行成功')
    await api.list({ data: ' 关键字 ', pageNo: 2, pageSize: 50 })
    await api.remove({ ids: ['9007199254740993'] })
    await api.run({ id: '9007199254740993' })
    expect(calls).toEqual([
      { url: '/mall-manage-api/sys/queueFailed/page', method: 'get', params: { order: '', orderField: '', data: ' 关键字 ', pageNo: 2, pageSize: 50 } },
      { url: '/mall-manage-api/sys/queueFailed/delete', method: 'delete', data: ['9007199254740993'] },
      { url: '/mall-manage-api/sys/queueFailed/run?id=9007199254740993', method: 'get' },
    ])
    expect(api.prepareRemove({ ids: [1] })).toEqual({ ids: [1] })
    expect(api.prepareRun({ id: 1 })).toEqual({ id: 1 })
  })

  it('详情动作不增加隐藏的详情请求，坏响应和坏参数在请求前失败', async () => {
    const { api, calls } = setup()
    await expect(api.remove({ ids: [] })).rejects.toThrow('非空数组')
    await expect(api.run({ id: 0 })).rejects.toThrow('正整数')
    await expect(api.list({ data: 1 as unknown as string })).rejects.toThrow('必须为字符串')
    const malformed = setup({ list: [], total: -1 })
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    expect(calls).toEqual([])
  })
})
