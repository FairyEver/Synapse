import { describe, expect, it, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import { createPortalDeviceCapability, portalDeviceCapabilities } from '../src/capabilities/portal-device.js'
import { PORTAL_DEVICE_CONTRACTS } from '../src/catalog/contracts-portal-device.js'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp } from '../src/http/client.js'
import { createPortalHeadless, createPortalServer } from '../src/index.js'

const own = { deviceCode: 'current-pc', deviceName: '办公室电脑', loginApp: 2, activeTime: 1789000000000 }
const other = { deviceCode: 'other-phone', deviceName: '手机', loginApp: 1, loginAppName: 'APP', loginTypeName: '验证码', activeArea: '上海', activeTime: '2026-09-01' }
function fixture(...responses: unknown[]) {
  const request = vi.fn(async () => {
    if (!responses.length) throw new Error('unexpected request')
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next
  })
  return { request, sdk: createPortalDeviceCapability(request as PortalRequest, { currentDeviceCode: 'current-pc' }) }
}

describe('门户登录设备：静态页面契约', () => {
  it('真实主门面 invoke 与 -llm 描述均可达，prepare 保持只读', async () => {
    const sdk = createPortalHeadless({
      baseUrl: 'https://default.invalid', credential: { token: 'session-fixture', tenantId: 1 },
      httpBaseUrls: { 'zhdj-app': 'https://devices.invalid' }, portalDevice: { currentDeviceCode: 'current-pc' },
    })
    const calls: InternalAxiosRequestConfig[] = []
    sdk.http.defaults.adapter = async config => {
      calls.push(config)
      return { data: { ret: 'SUCCESS', data: [other, own] }, status: 200, statusText: 'OK', headers: {}, config }
    }
    expect(await sdk.capabilities.invoke('portal-device-list', {})).toEqual([{ ...own, isCurrent: true }, { ...other, isCurrent: false }])
    expect(await sdk.capabilities.invoke('portal-device-prepare-remove', { targetDeviceCode: 'other-phone' })).toEqual({ ...other, isCurrent: false })
    expect(calls.map(call => call.url)).toEqual(['/device/list.json', '/device/list.json'])
    const info = sdk.catalog.describe('portal-device-prepare-remove-llm')
    if (!info.ok) throw new Error('prepare description unavailable')
    expect(info.ai?.effect).toBe('prepare')
    expect(info.ai?.steps[0]?.mapping).toEqual({ targetDeviceCode: 'result.deviceCode' })
    const remove = sdk.catalog.describe('portal-device-remove')
    if (!remove.ok) throw new Error('remove description unavailable')
    expect(remove.ai?.effect).toBe('write')
    expect(remove.ai?.gaps?.join(' ')).toContain('未做真实环境')
  })
  it('多用户主门面使用逐会话真实设备，缺失上下文不得继承其它用户', async () => {
    const request = vi.fn(async () => [other, own])
    const server = createPortalServer({ baseUrl: 'https://default.invalid', httpBaseUrls: { 'zhdj-app': 'https://devices.invalid' }, sessionOptions: { createRequest: () => request as PortalRequest } })
    const first = await server.forSession({ userId: 'first', credential: { token: 'first', tenantId: 1 }, capabilities: [], portalDevice: { currentDeviceCode: 'current-pc' } })
    const second = await server.forSession({ userId: 'second', credential: { token: 'second', tenantId: 2 }, capabilities: [], portalDevice: { currentDeviceCode: 'other-phone' } })
    const unknown = await server.forSession({ userId: 'third', credential: { token: 'third', tenantId: 3 }, capabilities: [] })
    await expect(first.capabilities.invoke('portal-device-remove', { targetDeviceCode: 'current-pc' })).rejects.toThrow('本机')
    await expect(second.capabilities.invoke('portal-device-remove', { targetDeviceCode: 'other-phone' })).rejects.toThrow('本机')
    await expect(unknown.capabilities.invoke('portal-device-remove', { targetDeviceCode: 'current-pc' })).rejects.toThrow('currentDeviceCode')
    expect(request).not.toHaveBeenCalled()
    expect(await second.capabilities.invoke('portal-device-list', {})).toEqual([{ ...other, isCurrent: true }, { ...own, isCurrent: false }])
  })
  it('缺少实例地址失败关闭；显式 host 与会话头不泄漏为默认租户请求', async () => {
    const raw = vi.fn(async () => []) as PortalRequest
    const noHost = createPageCall(raw)
    await expect(createPortalDeviceCapability(config => noHost('/base-data/login-device', config)).list()).rejects.toThrow('base URL')
    expect(raw).not.toHaveBeenCalled()
    const http = createPortalHttp({ baseUrl: 'https://default.invalid', credential: { token: 'user-session-test', tenantId: 91 } })
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({ data: { ret: 'SUCCESS', data: [] }, status: 200, statusText: 'OK', headers: {}, config }))
    http.defaults.adapter = adapter
    const pageCall = createPageCall((config => http.request(config)) as PortalRequest, undefined, { baseUrls: { 'zhdj-app': 'https://devices.invalid' } })
    await createPortalDeviceCapability(config => pageCall('/base-data/login-device', config)).list()
    const sent = adapter.mock.calls[0]![0] as { url: string; baseURL: string; headers: { toJSON(): Record<string, unknown> } }
    expect(sent.baseURL).toBe('https://devices.invalid')
    expect(sent.url).toBe('/device/list.json')
    expect(sent.headers.toJSON()).toMatchObject({ token: 'user-session-test', 'Accept-Language': 'zh-CN' })
    expect(sent.headers.toJSON()).not.toHaveProperty('tenant-id')
    expect(sent.headers.toJSON()).not.toHaveProperty('module-type')
  })
  it('使用 zhdj-app 原路径、当前设备优先且白名单屏蔽无关字段', async () => {
    const { sdk, request } = fixture({ list: [{ ...other, token: 'must-not-leak' }, own] })
    expect(await sdk.list()).toEqual([{ ...own, isCurrent: true }, { ...other, isCurrent: false }])
    expect(request).toHaveBeenCalledExactlyOnceWith({ url: '/device/list.json', method: 'get', httpInstance: 'zhdj-app' })
  })
  it('裸数组、空数组与未知本机分别保留语义，不伪造设备标识', async () => {
    const request = vi.fn(async () => [other]) as PortalRequest
    expect((await createPortalDeviceCapability(request).list())[0]?.isCurrent).toBeNull()
    expect(await fixture([]).sdk.list()).toEqual([])
    await expect(createPortalDeviceCapability(request).remove('other-phone')).rejects.toThrow('currentDeviceCode')
    expect(() => createPortalDeviceCapability(request, { currentDeviceCode: ' ' })).toThrow('非空标识')
  })
  it.each([null, {}, { list: null }, [{}]])('畸形列表不作为移除成功证据：%j', async response => {
    await expect(fixture(response).sdk.list()).rejects.toThrow()
  })
  it('PC 计数发送 clientType=pc，0 上限按前端回退为 5', async () => {
    const { sdk, request } = fixture({ count: 3, maxCount: 8 }, { count: 0, maxCount: 0 }, {})
    expect(await sdk.getCount()).toEqual({ currentCount: 3, maxCount: 8 })
    expect(request).toHaveBeenNthCalledWith(1, { url: '/device/count.json', method: 'get', params: { clientType: 'pc' }, httpInstance: 'zhdj-app' })
    expect(await sdk.getCount()).toEqual({ currentCount: 0, maxCount: 5 })
    expect(await sdk.getCount()).toEqual({ currentCount: 0, maxCount: 5 })
    await expect(fixture(null).sdk.getCount()).rejects.toThrow('不是对象')
  })
  it('本机移除在任何网络请求之前拒绝，准备过程只读', async () => {
    const { sdk, request } = fixture([own, other])
    await expect(sdk.remove('current-pc')).rejects.toThrow('本机')
    expect(request).not.toHaveBeenCalled()
    expect(await sdk.prepareRemove('other-phone')).toEqual({ ...other, isCurrent: false })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('未出现在当前账号列表的设备不得下线', async () => {
    const { sdk, request } = fixture([own])
    await expect(sdk.remove('other-phone')).rejects.toThrow('不在当前')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('移除 GET 是写入，必须请求前检查、请求后独立查询', async () => {
    const { sdk, request } = fixture([own, other], { arbitrary: true }, [own])
    expect(await sdk.remove('other-phone')).toEqual({ targetDeviceCode: 'other-phone', removed: true })
    expect(request.mock.calls).toEqual([
      [{ url: '/device/list.json', method: 'get', httpInstance: 'zhdj-app' }],
      [{ url: '/device/kick.json', method: 'get', params: { targetDeviceCode: 'other-phone' }, httpInstance: 'zhdj-app' }],
      [{ url: '/device/list.json', method: 'get', httpInstance: 'zhdj-app' }],
    ])
    expect(portalDeviceCapabilities.find(cap => cap.id === 'portal-device-remove')?.write).toBe(true)
  })
  it('请求成功但目标仍在不伪报完成；复查坏响应说明不确定且不重试', async () => {
    expect(await fixture([other], true, [other]).sdk.remove('other-phone')).toEqual({ targetDeviceCode: 'other-phone', removed: false })
    const { sdk, request } = fixture([other], true, {})
    await expect(sdk.remove('other-phone')).rejects.toThrow('结果不确定')
    expect(request).toHaveBeenCalledTimes(3)
    const failed = fixture([other], new Error('timeout'))
    await expect(failed.sdk.remove('other-phone')).rejects.toThrow('timeout')
    expect(failed.request).toHaveBeenCalledTimes(2)
  })
  it('不同实例本机上下文隔离，构造后修改入参不能绕过保护', async () => {
    const options = { currentDeviceCode: 'current-pc' }
    const request = vi.fn(async () => [own, other]) as PortalRequest
    const first = createPortalDeviceCapability(request, options)
    const second = createPortalDeviceCapability(request, { currentDeviceCode: 'other-phone' })
    options.currentDeviceCode = 'other-phone'
    await expect(first.remove('current-pc')).rejects.toThrow('本机')
    await expect(second.remove('other-phone')).rejects.toThrow('本机')
    expect(request).not.toHaveBeenCalled()
  })
  it('AI 说明锁定真实字段、映射、默认值与未知证据', async () => {
    const url = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(url)
    const bindings = new Map([
      ['portal-device-list', 'portalDevice.list'], ['portal-device-count', 'portalDevice.getCount'],
      ['portal-device-prepare-remove', 'portalDevice.prepareRemove'], ['portal-device-remove', 'portalDevice.remove'],
    ])
    expect(validateAiContracts(PORTAL_DEVICE_CONTRACTS, { profile: 'structural', definitions: portalDeviceCapabilities, bindings, sdkPaths: [...bindings.values()] })).toEqual([])
    const prepare = PORTAL_DEVICE_CONTRACTS['portal-device-prepare-remove']!
    expect(prepare.effect).toBe('prepare')
    expect(prepare.steps[0]?.mapping).toEqual({ targetDeviceCode: 'result.deviceCode' })
    expect(PORTAL_DEVICE_CONTRACTS['portal-device-remove']!.effect).toBe('write')
    expect(PORTAL_DEVICE_CONTRACTS['portal-device-remove']!.completion).toContain('removed=true')
    expect(PORTAL_DEVICE_CONTRACTS['portal-device-count']!.output.fields.find(field => field.path === 'maxCount')?.meaning).toContain('缺席或 0')
    expect(PORTAL_DEVICE_CONTRACTS['portal-device-list']!.output.fields.find(field => field.path === '[].isCurrent')?.nullMeaning).toContain('不是 false')
    expect(PORTAL_DEVICE_CONTRACTS['portal-device-remove']!.gaps?.join(' ')).toContain('未做真实环境')
  })
})
