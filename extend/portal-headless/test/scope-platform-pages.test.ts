import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import { sdkPathOf } from '../src/capabilities/invoke.js'

type CapturedCall = InternalAxiosRequestConfig & { url?: string; data?: unknown }

const typeRow = {
  id: '9007199254740993',
  name: '性别',
  type: 'sys_common_sex',
  status: 0,
  remark: null,
  createTime: '2026-09-25 10:00:00',
  useSystem: 0,
  tenantEditable: 1,
}

const dataRow = {
  id: '9007199254740994',
  sort: 1,
  label: '男',
  value: '1',
  dictType: 'sys_common_sex',
  status: 0,
  colorType: 'default',
  cssClass: '',
  remark: null,
  createTime: '2026-09-25 10:00:00',
  tenantId: 0,
  platform: false,
}

const exportRow = {
  id: '9007199254740995',
  name: '工资导出',
  message: null,
  fileType: 'xlsx',
  createDateString: '2026-09-25 10:00:00',
  completeDateString: null,
  statusString: '处理中',
  key: null,
  createDate: 1,
  completeDate: null,
  status: 0,
  type: 'export',
  isDisplay: '1',
}

const queueMysqlRow = {
  id: '9007199254740998',
  queueName: 'mail',
  worker: 'worker-1',
  params: '{}',
  createTime: 1720000000,
  lastConsumeTime: null,
  ownerThreadId: null,
  attempts: 1,
}

const failedRow = {
  id: '9007199254740996',
  queueName: 'mail',
  data: '{"id":1}',
  createTime: 1720000000,
  reason: '连接失败',
}

const scopedPages = [
  {
    pagePath: '/dashboard/platform/setting/dict-mall/common/list',
    permission: '/dashboard/platform-v2/setting/dict-mall/common',
    system: 0,
    moduleType: null,
    expectedIds: [
      'platform-dict-mall-common-type-list', 'platform-dict-mall-common-type-get', 'platform-dict-mall-common-type-create',
      'platform-dict-mall-common-type-update', 'platform-dict-mall-common-type-remove', 'platform-dict-mall-common-data-list',
      'platform-dict-mall-common-data-get', 'platform-dict-mall-common-data-create', 'platform-dict-mall-common-data-update',
      'platform-dict-mall-common-data-remove', 'platform-dict-mall-common-data-remove-batch',
    ],
    evidenceId: 'platform-dict-mall-common-type-list',
  },
  {
    pagePath: '/dashboard/platform/setting/dict-mall/hr/list',
    permission: '/dashboard/platform-v2/setting/dict-mall/hr',
    system: 1,
    moduleType: null,
    expectedIds: [
      'platform-dict-mall-hr-type-list', 'platform-dict-mall-hr-type-get', 'platform-dict-mall-hr-type-create',
      'platform-dict-mall-hr-type-update', 'platform-dict-mall-hr-type-remove', 'platform-dict-mall-hr-data-list',
      'platform-dict-mall-hr-data-get', 'platform-dict-mall-hr-data-create', 'platform-dict-mall-hr-data-update',
      'platform-dict-mall-hr-data-remove', 'platform-dict-mall-hr-data-remove-batch',
    ],
    evidenceId: 'platform-dict-mall-hr-type-list',
  },
  {
    pagePath: '/dashboard/platform/setting/dict-mall/finance/list',
    permission: '/dashboard/platform-v2/setting/dict-mall/finance',
    system: 2,
    moduleType: null,
    expectedIds: [
      'platform-dict-mall-finance-type-list', 'platform-dict-mall-finance-type-get', 'platform-dict-mall-finance-type-create',
      'platform-dict-mall-finance-type-update', 'platform-dict-mall-finance-type-remove', 'platform-dict-mall-finance-data-list',
      'platform-dict-mall-finance-data-get', 'platform-dict-mall-finance-data-create', 'platform-dict-mall-finance-data-update',
      'platform-dict-mall-finance-data-remove', 'platform-dict-mall-finance-data-remove-batch',
    ],
    evidenceId: 'platform-dict-mall-finance-type-list',
  },
  {
    pagePath: '/dashboard/platform/setting/dict-mall/material/list',
    permission: '/dashboard/platform-v2/setting/dict-mall/material',
    system: 3,
    moduleType: null,
    expectedIds: [
      'platform-dict-mall-material-type-list', 'platform-dict-mall-material-type-get', 'platform-dict-mall-material-type-create',
      'platform-dict-mall-material-type-update', 'platform-dict-mall-material-type-remove', 'platform-dict-mall-material-data-list',
      'platform-dict-mall-material-data-get', 'platform-dict-mall-material-data-create', 'platform-dict-mall-material-data-update',
      'platform-dict-mall-material-data-remove', 'platform-dict-mall-material-data-remove-batch',
    ],
    evidenceId: 'platform-dict-mall-material-type-list',
  },
  {
    pagePath: '/dashboard/platform/setting/dict-mall/product/list',
    permission: '/dashboard/platform-v2/setting/dict-mall/product',
    system: 4,
    moduleType: null,
    expectedIds: [
      'platform-dict-mall-product-type-list', 'platform-dict-mall-product-type-get', 'platform-dict-mall-product-type-create',
      'platform-dict-mall-product-type-update', 'platform-dict-mall-product-type-remove', 'platform-dict-mall-product-data-list',
      'platform-dict-mall-product-data-get', 'platform-dict-mall-product-data-create', 'platform-dict-mall-product-data-update',
      'platform-dict-mall-product-data-remove', 'platform-dict-mall-product-data-remove-batch',
    ],
    evidenceId: 'platform-dict-mall-product-type-list',
  },
  {
    pagePath: '/dashboard/platform/setting/dict-mall/supply/list',
    permission: '/dashboard/platform-v2/setting/dict-mall/supply',
    system: 5,
    moduleType: null,
    expectedIds: [
      'platform-dict-mall-supply-type-list', 'platform-dict-mall-supply-type-get', 'platform-dict-mall-supply-type-create',
      'platform-dict-mall-supply-type-update', 'platform-dict-mall-supply-type-remove', 'platform-dict-mall-supply-data-list',
      'platform-dict-mall-supply-data-get', 'platform-dict-mall-supply-data-create', 'platform-dict-mall-supply-data-update',
      'platform-dict-mall-supply-data-remove', 'platform-dict-mall-supply-data-remove-batch',
    ],
    evidenceId: 'platform-dict-mall-supply-type-list',
  },
  {
    pagePath: '/dashboard/platform/setting/dict-mall/sale/list',
    permission: '/dashboard/platform-v2/setting/dict-mall/sale',
    system: 6,
    moduleType: null,
    expectedIds: [
      'platform-dict-mall-sale-type-list', 'platform-dict-mall-sale-type-get', 'platform-dict-mall-sale-type-create',
      'platform-dict-mall-sale-type-update', 'platform-dict-mall-sale-type-remove', 'platform-dict-mall-sale-data-list',
      'platform-dict-mall-sale-data-get', 'platform-dict-mall-sale-data-create', 'platform-dict-mall-sale-data-update',
      'platform-dict-mall-sale-data-remove', 'platform-dict-mall-sale-data-remove-batch',
    ],
    evidenceId: 'platform-dict-mall-sale-type-list',
  },
  {
    pagePath: '/dashboard/platform/system/regular/queue/list',
    permission: '/dashboard/platform-v2/system/regular/queue',
    system: null,
    moduleType: null,
    expectedIds: ['platform-system-queue-mysql-list', 'platform-system-queue-mysql-prepare-remove', 'platform-system-queue-mysql-remove'],
    evidenceId: 'platform-system-queue-mysql-list',
  },
  {
    pagePath: '/dashboard/platform/system/queue/export/list',
    permission: '/dashboard/platform-v2/system/queue/export',
    system: null,
    moduleType: null,
    expectedIds: ['platform-system-queue-export-list', 'platform-system-queue-export-prepare-remove', 'platform-system-queue-export-remove'],
    evidenceId: 'platform-system-queue-export-list',
  },
  {
    pagePath: '/dashboard/platform/system/regular/fail/list',
    permission: '/dashboard/platform-v2/system/regular/fail',
    system: null,
    moduleType: null,
    expectedIds: [
      'platform-system-queue-failed-list', 'platform-system-queue-failed-prepare-remove', 'platform-system-queue-failed-remove',
      'platform-system-queue-failed-prepare-run', 'platform-system-queue-failed-run',
    ],
    evidenceId: 'platform-system-queue-failed-list',
  },
]

function responseData (url: string): unknown {
  if (url.includes('/dict-type/page')) return { list: [typeRow], total: 1 }
  if (url.includes('/dict-type/get')) return typeRow
  if (url.includes('/dict-type/create')) return typeRow.id
  if (url.includes('/dict-data/page')) return { list: [dataRow], total: 1 }
  if (url.includes('/dict-data/get')) return dataRow
  if (url.includes('/dict-data/create')) return dataRow.id
  if (url.includes('/sys/queueMysql/page')) return { list: [queueMysqlRow], total: 1 }
  if (url.includes('/sys/queueInOut/out/page')) return { list: [exportRow], total: 1 }
  if (url.includes('/sys/queueFailed/page')) return { list: [failedRow], total: 1 }
  if (url.includes('/dict-type/update') || url.includes('/dict-type/delete')) return true
  if (url.includes('/dict-data/update') || url.includes('/dict-data/delete')) return true
  if (url.includes('/sys/queueMysql/delete')) return true
  return true
}

function stubClient () {
  const sdk = createPortalHeadless({
    baseUrl: 'https://scope-platform-pages.invalid',
    credential: { token: 'offline', tenantId: 1 },
  })
  const calls: CapturedCall[] = []
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    const url = String(config.url ?? '')
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: responseData(url) },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  return { sdk, calls }
}

function bodyOf (call: CapturedCall | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.data ?? '{}')) as Record<string, unknown>
}

function paramsOf (call: CapturedCall | undefined): Record<string, unknown> {
  return (call?.params ?? {}) as Record<string, unknown>
}

function pathOf (call: CapturedCall | undefined): string {
  return new URL(String(call?.url ?? ''), 'https://scope-platform-pages.invalid').pathname
}

describe('范围审计：平台字典与队列保留页面', () => {
  it('每个保留页面的 capability 集合、菜单路径和权限都接入 SDK 目录', () => {
    const { sdk } = stubClient()

    for (const pageCase of scopedPages) {
      const pageCapabilities = sdk.capabilities.filter((capability) => capability.pagePath === pageCase.pagePath)
      expect(pageCapabilities.map((capability) => capability.id), pageCase.pagePath).toEqual(pageCase.expectedIds)
      expect(pageCapabilities.every((capability) => capability.permission === pageCase.permission && capability.httpInstance === 'platform' && capability.moduleType === pageCase.moduleType), pageCase.pagePath).toBe(true)

      const page = sdk.catalog.describePage(pageCase.pagePath)
      expect(page.ok, pageCase.pagePath).toBe(true)
      if (!page.ok) continue
      expect(page.page.menuPath).toBe(pageCase.pagePath)
      expect(page.page.permission).toBe(pageCase.permission)
      expect(page.capabilities.map((capability) => capability.capabilityId)).toEqual(pageCase.expectedIds)
      expect(page.pending).toBe(false)
    }
  })

  it('每个页面的每个 capability 都有完整描述和可执行 SDK 路径', () => {
    const { sdk } = stubClient()

    for (const pageCase of scopedPages) {
      for (const capabilityId of pageCase.expectedIds) {
        const description = sdk.catalog.describe(capabilityId)
        expect(description.ok, capabilityId).toBe(true)
        if (!description.ok) continue
        expect(description.capabilityId).toBe(capabilityId)
        expect(description.ai, capabilityId).toMatchObject({
          purpose: expect.any(String),
          whenToUse: expect.any(String),
          effect: expect.any(String),
          inputs: expect.any(Object),
          output: expect.any(Object),
          failures: expect.any(Array),
        })
        expect(description.invoke?.sdkPath, capabilityId).toBe(sdkPathOf(capabilityId))
        expect(description.invoke?.sdkPath, capabilityId).not.toBeNull()
        expect(sdk.catalog.describe(`${capabilityId}-llm`), capabilityId).toMatchObject({
          ok: true,
          ai: description.ai,
          invoke: { capabilityId, sdkPath: sdkPathOf(capabilityId) },
        })

        const [group, method] = description.invoke!.sdkPath.split('.')
        const target = Reflect.get(sdk, group!)
        expect(target, capabilityId).toBeDefined()
        if (target !== null && typeof target === 'object') expect(typeof Reflect.get(target, method!), capabilityId).toBe('function')
      }
    }
  })

  it('通过门面 invoke 锁定平台字典 CRUD、固定系统参数和批量删除映射', async () => {
    const { sdk, calls } = stubClient()

    for (const pageCase of scopedPages.slice(0, 7)) {
      const before = calls.length
      await sdk.capabilities.invoke(pageCase.evidenceId, { pageNo: 2, pageSize: 50 })
      expect(calls).toHaveLength(before + 1)
      const call = calls.at(-1)
      expect(call?.method, pageCase.pagePath).toBe('get')
      expect(pathOf(call), pageCase.pagePath).toBe('/adminmanage-api/system/dict-type/page')
      expect(String(call?.url), pageCase.pagePath).toContain(`useSystem=${pageCase.system}`)
      expect(String(call?.url), pageCase.pagePath).toContain('pageNo=2')
      expect(String(call?.url), pageCase.pagePath).toContain('pageSize=50')
    }

    await sdk.capabilities.invoke('platform-dict-mall-common-type-get', { id: typeRow.id })
    await sdk.capabilities.invoke('platform-dict-mall-common-type-create', { name: '颜色', type: 'sys_color', tenantEditable: 1, status: 0 })
    await sdk.capabilities.invoke('platform-dict-mall-common-type-update', { id: typeRow.id, name: '性别', type: typeRow.type, useSystem: 0, tenantEditable: 1, status: 0 })
    await sdk.capabilities.invoke('platform-dict-mall-common-type-remove', { id: typeRow.id })
    await sdk.capabilities.invoke('platform-dict-mall-common-data-list', { dictType: typeRow.type, label: '男', status: 0, pageNo: 2, pageSize: 50 })
    await sdk.capabilities.invoke('platform-dict-mall-common-data-get', { id: dataRow.id })
    await sdk.capabilities.invoke('platform-dict-mall-common-data-create', { dictType: typeRow.type, label: '女', value: '2', sort: 1, status: 0 })
    await sdk.capabilities.invoke('platform-dict-mall-common-data-update', { id: dataRow.id, dictType: typeRow.type, label: '男', value: '1', sort: 2, status: 0 })
    await sdk.capabilities.invoke('platform-dict-mall-common-data-remove', { id: dataRow.id, platform: false })
    await sdk.capabilities.invoke('platform-dict-mall-common-data-remove-batch', { ids: [dataRow.id, '9007199254740997'] })

    expect(calls.slice(7).map((call) => `${call.method} ${pathOf(call)}`)).toEqual([
      'get /adminmanage-api/system/dict-type/get',
      'post /adminmanage-api/system/dict-type/create',
      'put /adminmanage-api/system/dict-type/update',
      'delete /adminmanage-api/system/dict-type/delete',
      'get /adminmanage-api/system/dict-data/page',
      'get /adminmanage-api/system/dict-data/get',
      'post /adminmanage-api/system/dict-data/create',
      'put /adminmanage-api/system/dict-data/update',
      'delete /adminmanage-api/system/dict-data/delete',
      'delete /adminmanage-api/system/dict-data/delete',
    ])
    expect(String(calls[7]?.url)).toContain('id=9007199254740993')
    expect(bodyOf(calls[8])).toEqual({ name: '颜色', type: 'sys_color', useSystem: 0, tenantEditable: 1, remark: '', status: 0 })
    expect(bodyOf(calls[9])).toEqual({ id: typeRow.id, name: '性别', type: typeRow.type, useSystem: 0, tenantEditable: 1, remark: '', status: 0 })
    expect(paramsOf(calls[10])).toEqual({ id: typeRow.id })
    expect(String(calls[11]?.url)).toContain('dictType=sys_common_sex')
    expect(String(calls[11]?.url)).toContain('label=%E7%94%B7')
    expect(String(calls[12]?.url)).toContain('id=9007199254740994')
    expect(bodyOf(calls[13])).toEqual({ id: '', dictType: typeRow.type, dictTypeId: typeRow.type, label: '女', value: '2', sort: 1, status: 0, remark: '' })
    expect(bodyOf(calls[14])).toEqual({ id: dataRow.id, dictType: typeRow.type, label: '男', value: '1', sort: 2, remark: '', status: 0 })
    expect(paramsOf(calls[15])).toEqual({ id: dataRow.id })
    expect(paramsOf(calls[16])).toEqual({ ids: [dataRow.id, '9007199254740997'] })
  })

  it('通过门面 invoke 锁定导出队列与失败队列的列表、批量删除和手动执行映射', async () => {
    const { sdk, calls } = stubClient()

    await sdk.capabilities.invoke('platform-system-queue-mysql-list', { pageNo: 2, pageSize: 50 })
    expect(String(calls.at(-1)?.url)).toContain('/mall-manage-api/sys/queueMysql/page')
    await sdk.capabilities.invoke('platform-system-queue-mysql-prepare-remove', { ids: ['9007199254740998'] })
    await sdk.capabilities.invoke('platform-system-queue-mysql-remove', { ids: ['9007199254740998'] })
    expect(String(calls.at(-1)?.url)).toContain('/mall-manage-api/sys/queueMysql/delete')
    expect(bodyOf(calls.at(-1))).toEqual(['9007199254740998'])

    await sdk.capabilities.invoke('platform-system-queue-export-list', { pageNo: 2, pageSize: 50 })
    expect(String(calls.at(-1)?.url)).toContain('/mall-manage-api/sys/queueInOut/out/page')
    expect(String(calls.at(-1)?.url)).toContain('type=export')
    await sdk.capabilities.invoke('platform-system-queue-export-prepare-remove', { ids: [exportRow.id] })
    await sdk.capabilities.invoke('platform-system-queue-export-remove', { ids: [exportRow.id, '9007199254740997'] })
    expect(bodyOf(calls.at(-1))).toEqual([exportRow.id, '9007199254740997'])

    await sdk.capabilities.invoke('platform-system-queue-failed-list', { data: ' 关键字 ', pageNo: 2, pageSize: 50 })
    expect(String(calls.at(-1)?.url)).toContain('/mall-manage-api/sys/queueFailed/page')
    expect(String(calls.at(-1)?.url)).toContain('data=%20%E5%85%B3%E9%94%AE%E5%AD%97%20')
    await sdk.capabilities.invoke('platform-system-queue-failed-prepare-remove', { ids: [failedRow.id] })
    await sdk.capabilities.invoke('platform-system-queue-failed-remove', { ids: [failedRow.id] })
    expect(bodyOf(calls.at(-1))).toEqual([failedRow.id])
    await sdk.capabilities.invoke('platform-system-queue-failed-prepare-run', { id: failedRow.id })
    await sdk.capabilities.invoke('platform-system-queue-failed-run', { id: failedRow.id })
    expect(String(calls.at(-1)?.url)).toContain('/mall-manage-api/sys/queueFailed/run')
    expect(String(calls.at(-1)?.url)).toContain('id=9007199254740996')
  })
})
