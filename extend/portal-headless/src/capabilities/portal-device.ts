import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition } from './types.js'

/** Header menu -> login-device modal; not a fabricated standalone menu page. */
export const PORTAL_DEVICE_PAGE_PATH = '/base-data/login-device'
export const PORTAL_DEVICE_HTTP_INSTANCE = 'zhdj-app'
export type PortalDeviceOptions = { currentDeviceCode?: string }
export type PortalLoginDevice = {
  deviceCode: string
  deviceName?: string | null
  loginApp?: number | null
  loginAppName?: string | null
  loginTypeName?: string | null
  activeArea?: string | null
  activeTime?: string | number | null
  isCurrent: boolean | null
}

const targetParam = {
  name: 'targetDeviceCode', kind: 'text' as const, required: true,
  description: '登录设备列表中用户选定的 deviceCode，不能使用人员 ID 或设备名称。',
}
export const portalDeviceCapabilities: CapabilityDefinition[] = [
  { id: 'portal-device-list', title: '登录设备列表', params: [], write: false },
  { id: 'portal-device-count', title: 'PC 登录设备数量', params: [], write: false },
  { id: 'portal-device-prepare-remove', title: '准备移除登录设备', params: [targetParam], write: false },
  { id: 'portal-device-remove', title: '移除登录设备', params: [targetParam], write: true },
].map(item => ({ ...item, pagePath: PORTAL_DEVICE_PAGE_PATH, httpInstance: PORTAL_DEVICE_HTTP_INSTANCE }))

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}
function code(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是实际设备的非空标识，不能猜测或生成`)
  return value
}
function normalizeDevice(value: unknown, current: string | undefined): PortalLoginDevice {
  const source = record(value)
  if (!source) throw new Error('登录设备列表元素不是对象')
  const deviceCode = code(source.deviceCode, 'deviceCode')
  const result: PortalLoginDevice = { deviceCode, isCurrent: current === undefined ? null : deviceCode === current }
  for (const key of ['deviceName', 'loginAppName', 'loginTypeName', 'activeArea'] as const) {
    const value = source[key]
    if (value !== undefined) {
      if (value !== null && typeof value !== 'string') throw new Error(`登录设备 ${key} 不是字符串`)
      result[key] = value
    }
  }
  if (source.loginApp !== undefined) {
    if (source.loginApp !== null && (typeof source.loginApp !== 'number' || !Number.isFinite(source.loginApp))) {
      throw new Error('登录设备 loginApp 不是数值')
    }
    result.loginApp = source.loginApp as number | null
  }
  if (source.activeTime !== undefined) {
    const time = source.activeTime
    if (time !== null && typeof time !== 'string' && !(typeof time === 'number' && Number.isFinite(time))) {
      throw new Error('登录设备 activeTime 不是时间数值或字符串')
    }
    result.activeTime = time as string | number | null
  }
  return result
}

/** Caller binds request to one session and supplies zhdj-app's explicit base URL via createPageCall. */
export function createPortalDeviceCapability(request: PortalRequest, options: PortalDeviceOptions = {}) {
  // Snapshot prevents sharing a mutable options object from changing another user's guard.
  const currentDeviceCode = options.currentDeviceCode === undefined
    ? undefined : code(options.currentDeviceCode, 'currentDeviceCode')
  async function list(): Promise<PortalLoginDevice[]> {
    const payload = await request<unknown>({ url: '/device/list.json', method: 'get', httpInstance: PORTAL_DEVICE_HTTP_INSTANCE })
    const rows = Array.isArray(payload) ? payload : record(payload)?.list
    // Unlike the UI's empty fallback, malformed payloads must not prove a successful removal.
    if (!Array.isArray(rows)) throw new Error('登录设备响应缺少数组，不能当作空列表或移除成功')
    const devices = rows.map(row => normalizeDevice(row, currentDeviceCode))
    return devices.sort((a, b) => Number(b.isCurrent === true) - Number(a.isCurrent === true))
  }
  async function prepareRemove(targetDeviceCode: string): Promise<PortalLoginDevice> {
    const target = code(targetDeviceCode, 'targetDeviceCode')
    if (currentDeviceCode === undefined) throw new Error('移除设备需要调用方提供真实 currentDeviceCode；缺失时不能判断本机')
    if (target === currentDeviceCode) throw new Error('不能移除当前设备（本机）')
    const device = (await list()).find(row => row.deviceCode === target)
    if (!device) throw new Error('目标设备不在当前登录设备列表，请刷新后重新选择')
    return device
  }
  return {
    list,
    async getCount(): Promise<{ currentCount: number; maxCount: number }> {
      const payload = record(await request<unknown>({ url: '/device/count.json', method: 'get', params: { clientType: 'pc' }, httpInstance: PORTAL_DEVICE_HTTP_INSTANCE }))
      if (!payload) throw new Error('PC 设备数量响应不是对象')
      // service.js uses count || 0 and maxCount || 5, including maxCount=0 -> 5.
      const currentCount = payload.count || 0
      const maxCount = payload.maxCount || 5
      if (typeof currentCount !== 'number' || !Number.isFinite(currentCount) || typeof maxCount !== 'number' || !Number.isFinite(maxCount)) {
        throw new Error('PC 设备数量或上限不是有限数值')
      }
      return { currentCount, maxCount }
    },
    prepareRemove,
    async remove(targetDeviceCode: string): Promise<{ targetDeviceCode: string; removed: boolean }> {
      const device = await prepareRemove(targetDeviceCode)
      // GET is a write here. Do not put this endpoint behind a read-only retry policy.
      await request<unknown>({ url: '/device/kick.json', method: 'get', params: { targetDeviceCode: device.deviceCode }, httpInstance: PORTAL_DEVICE_HTTP_INSTANCE })
      try {
        const devices = await list()
        return { targetDeviceCode: device.deviceCode, removed: !devices.some(row => row.deviceCode === device.deviceCode) }
      } catch (cause) {
        throw new Error('移除请求已返回，但设备列表复查失败；结果不确定，先查询列表，不要直接重发移除', { cause })
      }
    },
  }
}
export type PortalDeviceCapability = ReturnType<typeof createPortalDeviceCapability>
