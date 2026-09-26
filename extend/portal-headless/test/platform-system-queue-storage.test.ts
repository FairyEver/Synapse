import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  buildPlatformSystemQueueStoragePayload,
  createPlatformSystemQueueStorageCapability,
  PLATFORM_SYSTEM_QUEUE_STORAGE_MODULE_TYPE,
  PLATFORM_SYSTEM_QUEUE_STORAGE_PAGE_PATH,
  PLATFORM_SYSTEM_QUEUE_STORAGE_PERMISSION,
  platformSystemQueueStorageCapabilities,
} from '../src/capabilities/platform-system-queue-storage.js'
import { PLATFORM_SYSTEM_QUEUE_STORAGE_AI_CONTRACTS } from '../src/catalog/contracts-platform-system-queue-storage.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    return results.shift() as T
  }
  return { api: createPlatformSystemQueueStorageCapability(request), calls }
}

const sourcePath = process.env.PORTAL_REPO
  ? `${process.env.PORTAL_REPO}/app/portal/views/dashboard/platform/system/queue/storage/list.vue`
  : '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js/app/portal/views/dashboard/platform/system/queue/storage/list.vue'
const portalSource = readFileSync(sourcePath, 'utf8')

describe('Portal 平台设置 → 存储方式页面能力', () => {
  it('锁定页面权限、platform-mall-admin实例、无module-type和仅有读/准备/保存动作', () => {
    expect(platformSystemQueueStorageCapabilities.map(item => item.id)).toEqual([
      'platform-system-queue-storage-get',
      'platform-system-queue-storage-prepare-save',
      'platform-system-queue-storage-save',
    ])
    expect(platformSystemQueueStorageCapabilities.every(item => item.pagePath === PLATFORM_SYSTEM_QUEUE_STORAGE_PAGE_PATH)).toBe(true)
    expect(platformSystemQueueStorageCapabilities.every(item => item.permission === PLATFORM_SYSTEM_QUEUE_STORAGE_PERMISSION)).toBe(true)
    expect(platformSystemQueueStorageCapabilities.every(item => item.httpInstance === 'platform-mall-admin')).toBe(true)
    expect(platformSystemQueueStorageCapabilities.every(item => item.moduleType === PLATFORM_SYSTEM_QUEUE_STORAGE_MODULE_TYPE)).toBe(true)
    expect(platformSystemQueueStorageCapabilities.filter(item => item.write).map(item => item.id)).toEqual(['platform-system-queue-storage-save'])
    expect(portalSource).toContain("http('/sys/queueInOut/getFTPSetting')")
    expect(portalSource).toContain("url: '/sys/queueInOut/saveFTPSetting'")
    expect(portalSource).toContain('data: {...formState.value}')
    expect(portalSource).not.toContain('useListPageModule')
  })

  it('读取配置保留五个FTP字段的原值和后端扩展字段', async () => {
    const response = { host: '192.168.45.123', port: '21', name: 'ftp-user', pass: 'secret', dir: '/queue', extra: 'keep' }
    const { api, calls } = setup(response)
    await expect(api.get()).resolves.toEqual(response)
    expect(calls).toEqual([{ url: '/sys/queueInOut/getFTPSetting', method: 'get', httpInstance: 'platform-mall-admin' }])
  })

  it('prepare只复制完整表单不发请求，save按Portal整对象POST且不改写空值', async () => {
    const form = { host: '', port: null, name: 'ftp-user', pass: 'secret', dir: '/queue', extra: 'keep' }
    const { api, calls } = setup('保存成功')
    expect(api.prepareSave({ form })).toEqual({ payload: form })
    expect(calls).toEqual([])
    await expect(api.save({ form })).resolves.toBeUndefined()
    expect(calls).toEqual([{ url: '/sys/queueInOut/saveFTPSetting', method: 'post', data: form, httpInstance: 'platform-mall-admin' }])
    expect(buildPlatformSystemQueueStoragePayload(form)).toEqual(form)
  })

  it('页面没有必填校验：空对象和空字符串可以准备，但已知字段非字符串在请求前失败', async () => {
    const { api, calls } = setup()
    expect(api.prepareSave({ form: {} })).toEqual({ payload: {} })
    expect(api.prepareSave({ form: { host: '' } })).toEqual({ payload: { host: '' } })
    await expect(api.save({ form: { port: 21 } as unknown as Parameters<typeof api.save>[0]['form'] })).rejects.toThrow('port必须为字符串')
    expect(calls).toEqual([])
    const malformed = setup(undefined)
    await expect(malformed.api.get()).rejects.toThrow('响应必须是对象')
    expect(malformed.calls).toEqual([{ url: '/sys/queueInOut/getFTPSetting', method: 'get', httpInstance: 'platform-mall-admin' }])
  })

  it('Java协议和AI契约锁定为基础设置FTP对象，未发布不存在的列表/新增/删除能力', () => {
    const javaController = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-crm/erp-module-crm-biz/src/main/java/com/wdbc/erp/module/crm/manage/modules/sys/controller/ManageSysQueueInOutController.java', 'utf8')
    const javaDto = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-crm/erp-module-crm-biz/src/main/java/com/wdbc/erp/module/crm/manage/modules/sys/dto/FTPSettingDTO.java', 'utf8')
    const javaConstants = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-crm/erp-module-crm-biz/src/main/java/com/wdbc/erp/module/crm/common/constant/Constants.java', 'utf8')
    expect(javaController).toContain('@GetMapping("getFTPSetting")')
    expect(javaController).toContain('@PostMapping("saveFTPSetting")')
    expect(javaDto).toMatch(/private String (host|port|name|pass|dir);/)
    expect(javaConstants).toContain('FTP_SETTING_APP = "importexport"')
    expect(javaConstants).toContain('FTP_SETTING_KEY = "ftp_server_setting"')
    expect(Object.keys(PLATFORM_SYSTEM_QUEUE_STORAGE_AI_CONTRACTS)).toEqual([
      'platform-system-queue-storage-get',
      'platform-system-queue-storage-prepare-save',
      'platform-system-queue-storage-save',
    ])
    expect(PLATFORM_SYSTEM_QUEUE_STORAGE_AI_CONTRACTS['platform-system-queue-storage-get']?.output.fields.map(field => field.path)).toEqual(['host', 'port', 'name', 'pass', 'dir'])
    expect(PLATFORM_SYSTEM_QUEUE_STORAGE_AI_CONTRACTS['platform-system-queue-storage-save']?.inputs).toEqual(expect.objectContaining({
      form: expect.objectContaining({ type: 'object', required: true }),
      'form.host': expect.objectContaining({ type: 'string | null', required: false }),
      'form.port': expect.objectContaining({ type: 'string | null', required: false }),
      'form.name': expect.objectContaining({ type: 'string | null', required: false }),
      'form.pass': expect.objectContaining({ type: 'string | null', required: false }),
      'form.dir': expect.objectContaining({ type: 'string | null', required: false }),
    }))
    expect(PLATFORM_SYSTEM_QUEUE_STORAGE_AI_CONTRACTS['platform-system-queue-storage-prepare-save']?.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'required', capabilityId: 'platform-system-queue-storage-save', mapping: { form: 'result.payload' } }),
      expect.objectContaining({ role: 'cancel', instruction: expect.stringContaining('不调用save') }),
    ]))
    expect(PLATFORM_SYSTEM_QUEUE_STORAGE_AI_CONTRACTS['platform-system-queue-storage-save']?.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'required', capabilityId: 'platform-system-queue-storage-get', mapping: {} }),
      expect.objectContaining({ role: 'cancel', instruction: expect.stringContaining('不能伪造cancel') }),
    ]))
  })
})
