import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  buildPlatformSystemCustomPayload,
  createPlatformSystemCustomCapability,
  PLATFORM_SYSTEM_CUSTOM_MODULE_TYPE,
  PLATFORM_SYSTEM_CUSTOM_PAGE_PATH,
  PLATFORM_SYSTEM_CUSTOM_PERMISSION,
  platformSystemCustomCapabilities,
} from '../src/capabilities/platform-system-custom.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    return results.shift() as T
  }
  return { api: createPlatformSystemCustomCapability(request), calls }
}

describe('平台系统配置页面动作', () => {
  it('锁定页面路径、v2权限、无module-type和列表默认分页', async () => {
    const { api, calls } = setup({
      list: [{ id: '9007199254740993', code: 'item_variety', name: '品种', body: '[]', info: null, modifiedTime: 1720000000 }],
      total: 1,
    })
    await expect(api.list()).resolves.toEqual({
      list: [{ id: '9007199254740993', code: 'item_variety', name: '品种', body: '[]', info: null, modifiedTime: 1720000000 }],
      total: 1,
    })
    expect(calls[0]).toEqual({
      url: '/mall-manage-api/sys/diyConf/page',
      method: 'get',
      params: { order: '', orderField: '', pageNo: 1, pageSize: 20 },
    })
    expect(PLATFORM_SYSTEM_CUSTOM_PAGE_PATH).toBe('/dashboard/platform/system/custom/list')
    expect(PLATFORM_SYSTEM_CUSTOM_PERMISSION).toBe('/dashboard/platform-v2/system/custom')
    expect(PLATFORM_SYSTEM_CUSTOM_MODULE_TYPE).toBeNull()
    expect(platformSystemCustomCapabilities.every(item => item.pagePath === PLATFORM_SYSTEM_CUSTOM_PAGE_PATH)).toBe(true)
    expect(platformSystemCustomCapabilities.every(item => item.permission === PLATFORM_SYSTEM_CUSTOM_PERMISSION)).toBe(true)
    expect(platformSystemCustomCapabilities.every(item => item.moduleType === null)).toBe(true)
  })

  it('按页面表单校验并把body数组序列化为JSON，创建保留id空字符串', async () => {
    const input = { code: 'item_variety', name: '品种', info: '品种说明', body: [{ text: '鸡', value: 'hen', info: '说明', pid: 1 }] }
    expect(buildPlatformSystemCustomPayload(input, 'create')).toEqual({
      id: '', code: 'item_variety', name: '品种', info: '品种说明', body: '[{"text":"鸡","value":"hen","info":"说明","pid":1}]',
    })
    const { api, calls } = setup('添加成功')
    await api.create(input)
    expect(calls[0]).toEqual({
      url: '/mall-manage-api/sys/diyConf/save',
      method: 'post',
      data: { id: '', code: 'item_variety', name: '品种', info: '品种说明', body: '[{"text":"鸡","value":"hen","info":"说明","pid":1}]' },
    })
  })

  it('编辑只提交页面桥接的五个字段，并重建body字符串', async () => {
    const input = { id: '9007199254740993', code: 'customized_sign', name: '专用标签', info: null, body: '[{"text":"A","value":"a","info":"","pid":2}]' }
    expect(buildPlatformSystemCustomPayload(input, 'update')).toEqual({
      id: '9007199254740993', code: 'customized_sign', name: '专用标签', info: '', body: '[{"text":"A","value":"a","info":"","pid":2}]',
    })
    const { api, calls } = setup('修改成功')
    await api.update(input)
    expect(calls[0]).toEqual({
      url: '/mall-manage-api/sys/diyConf/update',
      method: 'post',
      data: { id: '9007199254740993', code: 'customized_sign', name: '专用标签', info: '', body: '[{"text":"A","value":"a","info":"","pid":2}]' },
    })
  })

  it('页面必填、JSON数组和分页选项的负例在请求前失败', async () => {
    const { api, calls } = setup()
    await expect(api.create({ code: '', name: '品种', body: '[]' })).rejects.toThrow('配置代码')
    await expect(api.create({ code: 'code', name: '', body: '[]' })).rejects.toThrow('配置名称')
    await expect(api.create({ code: 'code', name: '品种', body: '{"text":"bad"}' })).rejects.toThrow('JSON数组')
    await expect(api.create({ code: 'code', name: '品种', body: '[1]' })).rejects.toThrow('body[0]必须是对象')
    await expect(api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    await expect(api.update({ id: '', code: 'code', name: '品种', body: '[]' })).rejects.toThrow('系统配置ID')
    expect(calls).toEqual([])
  })

  it('空body复刻页面的body || []，并保持未知配置项字段', () => {
    expect(buildPlatformSystemCustomPayload({ code: 'x', name: 'X', body: '' }, 'create').body).toBe('[]')
    expect(buildPlatformSystemCustomPayload({ code: 'x', name: 'X', body: [{ pid: 1, extra: { keep: true } }] }, 'create').body).toBe('[{"pid":1,"extra":{"keep":true}}]')
  })
})
