import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingEpidemicPreventionCostCapability,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHODS,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_MODULE_TYPE,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PERMISSION,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_QUERY_PERMISSION,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_SUBMIT_PERMISSION,
  productSettingEpidemicPreventionCostCapabilities,
  type ProductSettingEpidemicPreventionCostCreateForm,
} from '../src/capabilities/product-setting-epidemic-prevention-cost.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-epidemic-prevention-cost.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingEpidemicPreventionCostCreateForm = {
  year: 2026,
  weekAgeBegin: 1,
  weekAgeEnd: 4,
  gen: '2',
  farm: 'farm-1',
  vaccineUnitCost: 1.2,
  veterinaryDrugUnitCost: 2.3,
  disinfectantUnitCost: 0.8,
  moulting: 1,
}

const row = {
  id: 'epidemic-cost-1',
  year: 2026,
  moulting: 1,
  weekAgeBegin: 1,
  weekAgeEnd: 4,
  farm: 'farm-1',
  farmName: '一场',
  gen: '2',
  genName: '二代',
  vaccineUnitCost: 1.2,
  veterinaryDrugUnitCost: 2.3,
  disinfectantUnitCost: 0.8,
  satisfaction: null,
  rawExtension: 'keep',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingEpidemicPreventionCostCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function captureProduct () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({ baseUrl: 'https://biz-api-test.wodecorp.cn', credential: { token: 'fixture-token', tenantId: 7 } })
  http.defaults.adapter = async config => {
    calls.push(config)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data: { page: { list: [row], total: 1 } } }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
    { baseUrls: { product: 'https://biz-api-test.wodecorp.cn/flockSimu' } },
  )
  const api = createProductSettingEpidemicPreventionCostCapability(config => call(PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH, { ...config, httpInstance: 'product' }))
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 标准库管理 → 只鸡防疫成本标准页面能力', () => {
  it('逐页锁定菜单、权限、列表/联动、弹窗和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/epidemic-prevention-cost/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/epidemic-prevention-cost/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/EpidemicPreventionCostController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/standard/EpidemicPreventionCost.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/base/EpidemicPreventionCostDTO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/EpidemicPreventionCostServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/standard/EpidemicPreventionCostMapperExt.xml')
    expect(menu).toContain(`path: '${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_SUBMIT_PERMISSION}'`,
      "http.get('/base/epidemicPreventionCost/page'",
      "http.post('/base/epidemicPreventionCost/save'",
      "http.delete(`/base/epidemicPreventionCost/${record.id}`)",
      'v-if="permissionCheck(permissions.submit)"',
      'handleFarmAfterLoad',
      'farmLabelMap[String(record.farm)]',
      'farm: \'\'',
      'moulting: 0',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "year: [{ required: true",
      "weekAgeBegin: [{ required: true",
      "weekAgeEnd: [{ required: true",
      "vaccineUnitCost: [{ required: true",
      "farm: [{ required: true",
      'gen: formState.gen === \'\' ? \'\' : Number(formState.gen)',
      'farm: formState.farm',
      '...props.raw',
    ]) expect(modal).toContain(fragment)
    for (const fragment of ['@RequestMapping("flockSimu/base/epidemicPreventionCost")', '@GetMapping("page")', '@PostMapping("save")', '@DeleteMapping("{id}")', 'setFarmName', 'setGenName', 'PageParam.buildPageRequest()']) expect(controller).toContain(fragment)
    for (const field of ['weekAgeBegin', 'weekAgeEnd', 'farm', 'gen', 'vaccineUnitCost', 'veterinaryDrugUnitCost', 'disinfectantUnitCost']) expect(entity).toContain(field)
    for (const field of ['farmName', 'genName']) expect(dto).toContain(field)
    for (const fragment of ['updateByPrimaryKeySelective', 'insertSelective', 'setDelFlag(1)']) expect(service).toContain(fragment)
    for (const fragment of ['AND farm = #{farm}', 'AND `year` = #{year}', 'AND moulting = #{moulting}', 'AND gen = #{gen}', 'del_flag = 0']) expect(mapper).toContain(fragment)
  })

  it('列表按Portal筛选和分页发送，保留farmName/genName联动展示字段', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ farm: 'farm-1', year: '2026', moulting: 1, gen: '2', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{ url: '/base/epidemicPreventionCost/page', method: 'get', params: { order: '', orderField: '', farm: 'farm-1', year: '2026', moulting: 1, gen: '2', pageNo: 2, pageSize: 50 } }])
    const defaults = fixture([{ page: { list: [], total: 0 } }])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', farm: '', year: '', moulting: 0, gen: '', pageNo: 1, pageSize: 20 })
  })

  it('新建和编辑按Portal Number转换，编辑保留raw，删除使用路径参数', async () => {
    const f = fixture([{}, {}])
    const prepared = f.api.prepareCreate(form)
    expect(prepared.draft).toMatchObject({ year: 2026, weekAgeBegin: 1, weekAgeEnd: 4, gen: 2, farm: 'farm-1', moulting: 1, vaccineUnitCost: 1.2 })
    await expect(f.api.create(prepared)).resolves.toBe(true)
    const update = f.api.prepareUpdate({ ...row, ...form, id: row.id, vaccineUnitCost: '1.5' })
    expect(update.draft).toMatchObject({ id: row.id, gen: 2, vaccineUnitCost: 1.5, rawExtension: 'keep' })
    await expect(f.api.update(update)).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/base/epidemicPreventionCost/save', method: 'post', data: prepared.draft },
      { url: '/base/epidemicPreventionCost/save', method: 'post', data: update.draft },
      { url: `/base/epidemicPreventionCost/${row.id}`, method: 'delete' },
    ])
  })

  it('必填、枚举、数值、分页和坏响应失败且不发请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, farm: '' })).toThrow('场区')
    expect(() => f.api.prepareCreate({ ...form, gen: '' })).toThrow('代次')
    expect(() => f.api.prepareCreate({ ...form, moulting: 2 as never })).toThrow('是否换羽')
    expect(() => f.api.prepareCreate({ ...form, vaccineUnitCost: 10_000_001 })).toThrow('疫苗')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])
    await expect(fixture([{ page: { list: [{ ...row, moulting: 2 }], total: 1 } }]).api.list()).rejects.toThrow('是否换羽')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例追加devicetype，当前页面不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ id: row.id })] })
    expect(captured.calls[0]?.url).toBe('/base/epidemicPreventionCost/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(productSettingEpidemicPreventionCostCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHODS))
    expect(productSettingEpidemicPreventionCostCapabilities.every(item => item.pagePath === PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH && item.permission === PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_MODULE_TYPE)).toBe(true)
    expect(AI_CONTRACTS['product-setting-epidemic-prevention-cost-list']).toBe(contracts['product-setting-epidemic-prevention-cost-list'])
    expect(METHOD_CONTRACTS['productSettingEpidemicPreventionCost.list']).toBe(methodContracts['productSettingEpidemicPreventionCost.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-epidemic-prevention-cost-prepare-create' && item.sdkPath === 'productSettingEpidemicPreventionCost.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-epidemic-prevention-cost-prepare-remove' && item.sdkPath === 'productSettingEpidemicPreventionCost.prepareRemove')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-epidemic-prevention-cost-remove' && item.sdkPath === 'productSettingEpidemicPreventionCost.remove')).toBe(true)
    expect(contracts['product-setting-epidemic-prevention-cost-create']?.steps[0]?.capabilityId).toBe('product-setting-epidemic-prevention-cost-list')
    expect(contracts['product-setting-epidemic-prevention-cost-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_SUBMIT_PERMISSION)
  })
})
