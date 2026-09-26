import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import {
  createPlatformSystemQueueExportCapability,
  PLATFORM_SYSTEM_QUEUE_EXPORT_MODULE_TYPE,
  PLATFORM_SYSTEM_QUEUE_EXPORT_PAGE_PATH,
  PLATFORM_SYSTEM_QUEUE_EXPORT_PERMISSION,
  platformSystemQueueExportCapabilities,
} from '../src/capabilities/platform-system-queue-export.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    return results.shift() as T
  }
  return { api: createPlatformSystemQueueExportCapability(request), calls }
}

const page = {
  list: [{ id: '9007199254740993', name: '工资导出', message: null, fileType: 'xlsx', createDateString: '2026-09-23 10:00:00', completeDateString: null, statusString: '处理中', key: null, createDate: 1, completeDate: null, status: 0, type: 'export', isDisplay: '1' }],
  total: 1,
}

describe('Portal 平台设置 → 导出队列页面能力', () => {
  it('锁定页面、权限、platform实例、无module-type和分页列表', async () => {
    const { api, calls } = setup(page)
    await expect(api.list()).resolves.toEqual(page)
    expect(calls[0]).toEqual({
      url: '/mall-manage-api/sys/queueInOut/out/page', method: 'get',
      params: { order: '', orderField: '', type: 'export', pageNo: 1, pageSize: 20 },
    })
    expect(platformSystemQueueExportCapabilities.every(item => item.pagePath === PLATFORM_SYSTEM_QUEUE_EXPORT_PAGE_PATH)).toBe(true)
    expect(platformSystemQueueExportCapabilities.every(item => item.permission === PLATFORM_SYSTEM_QUEUE_EXPORT_PERMISSION)).toBe(true)
    expect(platformSystemQueueExportCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(platformSystemQueueExportCapabilities.every(item => item.moduleType === PLATFORM_SYSTEM_QUEUE_EXPORT_MODULE_TYPE)).toBe(true)
  })

  it('批量删除使用页面选中ID数组，并提供请求前准备步骤', async () => {
    const { api, calls } = setup('删除成功')
    expect(api.prepareRemove({ ids: ['9007199254740993', 7] })).toEqual({ ids: ['9007199254740993', 7] })
    await api.remove({ ids: ['9007199254740993', 7] })
    expect(calls[0]).toEqual({ url: '/mall-manage-api/sys/queueInOut/out/delete', method: 'delete', data: ['9007199254740993', 7] })
  })

  it('坏分页、坏ID和空删除集合在发请求前失败', async () => {
    const { api, calls } = setup()
    await expect(api.remove({ ids: [] })).rejects.toThrow('非空数组')
    await expect(api.remove({ ids: [0] })).rejects.toThrow('正整数')
    const malformed = setup({ list: [], total: -1 })
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    expect(calls).toEqual([])
  })
})
