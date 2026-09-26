import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import { createPlatformSystemQueueMysqlCapability, PLATFORM_SYSTEM_QUEUE_MYSQL_MODULE_TYPE, PLATFORM_SYSTEM_QUEUE_MYSQL_PAGE_PATH, PLATFORM_SYSTEM_QUEUE_MYSQL_PERMISSION, platformSystemQueueMysqlCapabilities } from '../src/capabilities/platform-system-queue-mysql.js'
type RequestConfig = Parameters<PortalRequest>[0]
function setup (...results: unknown[]) { const calls: RequestConfig[] = []; const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => { calls.push(config); return results.shift() as T }; return { api: createPlatformSystemQueueMysqlCapability(request), calls } }
const page = { list: [{ id: '9007199254740993', queueName: 'order', worker: 'OrderWorker', params: '{}', createTime: 1720000000, lastConsumeTime: null, ownerThreadId: 17, attempts: 2 }], total: 1 }
describe('Portal 平台设置 → 队列管理页面能力', () => {
  it('锁定页面、权限、platform实例、无module-type和分页默认参数', async () => {
    const { api, calls } = setup(page)
    await expect(api.list()).resolves.toEqual(page)
    expect(calls[0]).toEqual({ url: '/mall-manage-api/sys/queueMysql/page', method: 'get', params: { order: '', orderField: '', pageNo: 1, pageSize: 20 } })
    expect(platformSystemQueueMysqlCapabilities.every(item => item.pagePath === PLATFORM_SYSTEM_QUEUE_MYSQL_PAGE_PATH)).toBe(true)
    expect(platformSystemQueueMysqlCapabilities.every(item => item.permission === PLATFORM_SYSTEM_QUEUE_MYSQL_PERMISSION)).toBe(true)
    expect(platformSystemQueueMysqlCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(platformSystemQueueMysqlCapabilities.every(item => item.moduleType === PLATFORM_SYSTEM_QUEUE_MYSQL_MODULE_TYPE)).toBe(true)
  })
  it('批量删除使用选中ID数组，prepare不发请求', async () => {
    const { api, calls } = setup('删除成功')
    expect(api.prepareRemove({ ids: ['9007199254740993'] })).toEqual({ ids: ['9007199254740993'] })
    await api.remove({ ids: ['9007199254740993'] })
    expect(calls[0]).toEqual({ url: '/mall-manage-api/sys/queueMysql/delete', method: 'delete', data: ['9007199254740993'] })
  })
  it('坏分页、坏ID和空删除集合在请求前失败', async () => {
    const { api, calls } = setup()
    await expect(api.remove({ ids: [] })).rejects.toThrow('非空数组')
    await expect(api.remove({ ids: [0] })).rejects.toThrow('正整数')
    const malformed = setup({ list: [], total: -1 })
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    expect(calls).toEqual([])
  })
})
