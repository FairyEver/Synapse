import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingHatchAnnualMonthlyCapability,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHODS,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_SUBMIT_PERMISSION,
  productSettingHatchAnnualMonthlyCapabilities,
  type ProductSettingHatchAnnualMonthlyCreateForm,
} from '../src/capabilities/product-setting-hatch-annual-monthly.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-hatch-annual-monthly.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingHatchAnnualMonthlyCreateForm = {
  year: 2026,
  month: 4,
  hall: 'hall-1',
  healthyFemaleRate: 82,
  eggChickRatio: 1.25,
  type: 3,
}

const row = {
  id: 'hatch-annual-monthly-1',
  type: 3,
  year: 2026,
  month: 4,
  hall: 'hall-1',
  hallName: null,
  healthyFemaleRate: 82,
  eggChickRatio: 1.25,
  rawExtension: 'preserved-on-update',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingHatchAnnualMonthlyCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function captureProduct () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { page: { list: [row], total: 1 } } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
    { baseUrls: { product: 'https://biz-api-test.wodecorp.cn/flockSimu' } },
  )
  const api = createProductSettingHatchAnnualMonthlyCapability(config => call(PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH, { ...config, httpInstance: 'product' }))
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 标准库管理 → 年月指标目标标准页面能力', () => {
  it('逐页锁定菜单、路由、product实例、权限、列表/弹窗和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/hatch-annual-monthly.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/hatch-annual-monthly/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/hatch-annual-monthly/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/HatchAnnualMonthlyController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/standard/HatchAnnualMonthly.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/HatchAnnualMonthlyServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/standard/HatchAnnualMonthlyMapperExt.xml')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION}'`)
    expect(route).toContain(`permission: ${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION}`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_SUBMIT_PERMISSION}'`,
      "http.get('/base/hatchAnnualMonthly/page'",
      "http.post('/base/hatchAnnualMonthly/save'",
      "http.delete(`/base/hatchAnnualMonthly/${record.id}`)",
      'v-if="permissionCheck(permissions.submit)"',
      'handleHallAfterLoad',
      'getHallLabel(record.hall)',
      "hall: ''",
      'month: 1',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "year: [{ required: true",
      "month: [{ required: true",
      "hall: [{ required: true",
      "healthyFemaleRate: [{ required: true",
      "eggChickRatio: [{ required: true",
      "type: [{ required: true",
      'healthyFemaleRate: Number(formState.healthyFemaleRate) / 100',
      '...props.raw',
      'formState.type = props.raw.type || 3',
    ]) expect(modal).toContain(fragment)
    for (const fragment of ['@RequestMapping("flockSimu/base/hatchAnnualMonthly")', '@GetMapping("page")', '@PostMapping("save")', '@DeleteMapping("{id}")', 'PageParam.responsePage(resultList)', 'multiplyNumHandle(dto,100)']) expect(controller).toContain(fragment)
    for (const field of ['type', 'year', 'month', 'hall', 'healthyFemaleRate', 'eggChickRatio', 'hallName']) expect(entity).toContain(field)
    for (const fragment of ['updateByPrimaryKeySelective(hatchAnnualMonthly)', 'insertSelective(hatchAnnualMonthly)', 'setDelFlag(1)', 'setHallName']) expect(service).toContain(fragment)
    for (const fragment of ['AND hall=#{hall}', 'AND year=#{year}', 'AND month=#{month}', 'AND type=#{type}', 'del_flag = 0']) expect(mapper).toContain(fragment)
  })

  it('列表按Portal筛选和分页发送，默认月份为1且保留服务端响应值', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ hall: 'hall-1', year: 2026, month: 4, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{
      url: '/base/hatchAnnualMonthly/page',
      method: 'get',
      params: { order: '', orderField: '', hall: 'hall-1', year: '2026', month: 4, pageNo: 2, pageSize: 50 },
    }])
    const defaults = fixture([{ page: { list: [], total: 0 } }])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', hall: '', year: '', month: 1, pageNo: 1, pageSize: 20 })
    const clearedMonth = fixture([{ page: { list: [], total: 0 } }])
    await expect(clearedMonth.api.list({ month: null })).resolves.toEqual({ list: [], total: 0 })
    expect(clearedMonth.calls[0]?.params).toMatchObject({ month: null })
  })

  it('新建和编辑按Portal规则把健母雏率除以100，保留raw，删除使用路径参数', async () => {
    const f = fixture([{}, {}])
    const prepared = f.api.prepareCreate(form)
    expect(prepared.draft).toMatchObject({ year: 2026, month: 4, hall: 'hall-1', healthyFemaleRate: 0.82, eggChickRatio: 1.25, type: 3 })
    await expect(f.api.create(prepared)).resolves.toBe(true)
    const update = f.api.prepareUpdate({ ...row, ...form, id: row.id })
    expect(update.draft).toMatchObject({ id: row.id, healthyFemaleRate: 0.82, eggChickRatio: 1.25, rawExtension: 'preserved-on-update' })
    await expect(f.api.update(update)).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/base/hatchAnnualMonthly/save', method: 'post', data: prepared.draft },
      { url: '/base/hatchAnnualMonthly/save', method: 'post', data: update.draft },
      { url: `/base/hatchAnnualMonthly/${row.id}`, method: 'delete' },
    ])
  })

  it('坏输入、坏分页和坏响应不会静默降级或发请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, year: 1969 })).toThrow('年度')
    expect(() => f.api.prepareCreate({ ...form, month: 13 })).toThrow('月度')
    expect(() => f.api.prepareCreate({ ...form, hall: '' })).toThrow('孵化厅')
    expect(() => f.api.prepareCreate({ ...form, healthyFemaleRate: 10_000_001 })).toThrow('健母雏率')
    expect(() => f.api.prepareCreate({ ...form, type: 2 as never })).toThrow('年月类型')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.list({ month: 13 })).rejects.toThrow('月份')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])
    await expect(fixture([{ page: { list: [{ ...row, healthyFemaleRate: 'bad' }], total: 1 } }]).api.list()).rejects.toThrow('healthyFemaleRate')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例追加devicetype，当前页面不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ id: row.id })] })
    expect(captured.calls[0]?.url).toBe('/base/hatchAnnualMonthly/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(productSettingHatchAnnualMonthlyCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHODS))
    expect(productSettingHatchAnnualMonthlyCapabilities.every(item => item.pagePath === PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH && item.permission === PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_MODULE_TYPE)).toBe(true)
    expect(AI_CONTRACTS['product-setting-hatch-annual-monthly-list']).toBe(contracts['product-setting-hatch-annual-monthly-list'])
    expect(METHOD_CONTRACTS['productSettingHatchAnnualMonthly.list']).toBe(methodContracts['productSettingHatchAnnualMonthly.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-hatch-annual-monthly-prepare-create' && item.sdkPath === 'productSettingHatchAnnualMonthly.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-hatch-annual-monthly-prepare-remove' && item.sdkPath === 'productSettingHatchAnnualMonthly.prepareRemove')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-hatch-annual-monthly-remove' && item.sdkPath === 'productSettingHatchAnnualMonthly.remove')).toBe(true)
    expect(contracts['product-setting-hatch-annual-monthly-create']?.steps[0]?.capabilityId).toBe('product-setting-hatch-annual-monthly-list')
    expect(contracts['product-setting-hatch-annual-monthly-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_SUBMIT_PERMISSION)
  })
})
