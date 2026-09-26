import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingDictPlatformSaleCapability,
  SETTING_DICT_PLATFORM_SALE_METHODS,
  SETTING_DICT_PLATFORM_SALE_PAGE_PATH,
  SETTING_DICT_PLATFORM_SALE_PERMISSION,
  SETTING_DICT_PLATFORM_SALE_SYSTEM,
  settingDictPlatformSaleCapabilities,
} from '../src/capabilities/setting-dict-platform-sale.js'
import { SETTING_DICT_PLATFORM_SALE_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-dict-platform-sale.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingDictPlatformSaleCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const typeRow = { id: '9207199254740993', name: '销售类型', type: 'sale_type', status: 0, remark: null, createTime: '2026-09-25 10:00:00', useSystem: 6, tenantEditable: 1 }
const dataRow = { id: '9207199254740994', sort: 1, label: '直销', value: 'direct', dictType: 'sale_type', status: 0, colorType: 'default', cssClass: '', remark: null, createTime: '2026-09-25 10:00:00', tenantId: 42, platform: false }

describe('Portal 系统设置 → 销售字典', () => {
  it('逐页核对菜单、wrapper、共享数据子页和能力边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/sale/list.vue')
    const dataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/sale/data/[type]/items.vue')
    const dataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/sale/data/[type]/[mode]/[id].vue')
    const shared = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue')
    expect(menu).toContain(`path: '${SETTING_DICT_PLATFORM_SALE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_DICT_PLATFORM_SALE_PERMISSION}'`)
    expect(list).toContain('<ListPage :useSystem="SYSTEM_SALE_VALUE"/>')
    expect(dataList).toContain('<ListPage :useSystem="SYSTEM_SALE_VALUE"/>')
    expect(dataForm).toContain('<FormPage :useSystem="SYSTEM_SALE_VALUE"/>')
    expect(shared).toContain("'/admin-api/system/dict-data/page'")
    expect(settingDictPlatformSaleCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_DICT_PLATFORM_SALE_METHODS))
    expect(settingDictPlatformSaleCapabilities.every(item => item.pagePath === SETTING_DICT_PLATFORM_SALE_PAGE_PATH && item.permission === SETTING_DICT_PLATFORM_SALE_PERMISSION && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_DICT_PLATFORM_SALE_PAGE_PATH).moduleType).toBeNull()
  })

  it('固定 useSystem=6，复刻查询和写入请求并拒绝平台行', async () => {
    const f = fixture([{ list: [typeRow], total: 1 }, { list: [dataRow], total: 1 }, dataRow, '9207199254740995', true, true])
    await expect(f.api.list({ name: '销售', type: 'sale', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [typeRow], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/admin-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: SETTING_DICT_PLATFORM_SALE_SYSTEM, name: '销售', type: 'sale', pageNo: 2, pageSize: 50 } })
    await expect(f.api.dataList({ dictType: dataRow.dictType, label: '直销', status: 0 })).resolves.toEqual({ list: [dataRow], total: 1 })
    await expect(f.api.dataGet({ id: dataRow.id })).resolves.toEqual(dataRow)
    await expect(f.api.dataCreate({ dictType: dataRow.dictType, label: '经销', value: 'dealer' })).resolves.toBe('9207199254740995')
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: dataRow.dictType, label: '直销2', value: 'direct2' })).resolves.toBe(true)
    await expect(f.api.dataRemove({ id: dataRow.id })).resolves.toBe(true)
    expect(f.calls.map(call => call.url)).toEqual(['/admin-api/system/dict-type/page', '/admin-api/system/dict-data/page', '/admin-api/system/dict-data/get', '/admin-api/system/dict-data/create', '/admin-api/system/dict-data/update', '/admin-api/system/dict-data/delete'])
    await expect(fixture().api.dataUpdate({ id: dataRow.id, dictType: dataRow.dictType, label: '直销', value: 'direct', platform: true })).rejects.toThrow('只读')
  })

  it('AI contract 覆盖六项能力且坏映射会红', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_DICT_PLATFORM_SALE_METHODS).sort())
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    const bindings = new Map(settingDictPlatformSaleCapabilities.map(definition => [definition.id, `settingDictPlatformSale.${SETTING_DICT_PLATFORM_SALE_METHODS[definition.id as keyof typeof SETTING_DICT_PLATFORM_SALE_METHODS]}`]))
    expect(validateAiContracts(contracts, { definitions: settingDictPlatformSaleCapabilities, bindings })).toEqual([])
    const broken = structuredClone(contracts)
    const key = 'setting-dict-platform-sale-data-create'
    broken[key]!.steps[0]!.mapping!.dictType = 'result.list[].missingType'
    expect(validateAiContracts(broken, { definitions: settingDictPlatformSaleCapabilities, bindings })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-source-field' })]))
  })
})
