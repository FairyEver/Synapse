import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingChickenProductionCapability,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_METHODS,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_MODULE_TYPE,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_PERMISSION,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_QUERY_PERMISSION,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_SUBMIT_PERMISSION,
  productSettingChickenProductionCapabilities,
  type ProductSettingChickenProductionCreateForm,
} from '../src/capabilities/product-setting-chicken-production.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_CHICKEN_PRODUCTION_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-chicken-production.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingChickenProductionCreateForm = {
  year: 2026,
  moulting: 1,
  weekAge: 12,
  gen: 'G1',
  variety: 'V1',
  line: 'L1',
  lineVer: 2,
  layingRate: 82,
  passRate: 96,
  fertilityRate: 94,
  maleDeathsRate: 1.2,
  femaleDeathsRate: 2.4,
  maleDeathEliminationRate: 1.5,
  femaleDeathEliminationRate: 2.8,
  maleEliminationRate: 0.8,
  femaleEliminationRate: 1.1,
  femaleWeight: 1800,
  evennessDegree: 85,
  femaleTibiaLength: 105,
  dailyConsumption: 115,
  maleWeight: 2500,
  maleTibiaLength: 125,
  eggWeight: 62,
}

const row = {
  id: 'chicken-production-1',
  year: 2026,
  moulting: 1,
  weekAge: 12,
  gen: 'G1',
  variety: 'V1',
  line: 'L1',
  lineVer: '2',
  layingRate: 82,
  passRate: 96,
  fertilityRate: 94,
  maleDeathsRate: 1.2,
  femaleDeathsRate: 2.4,
  maleDeathEliminationRate: 1.5,
  femaleDeathEliminationRate: 2.8,
  maleEliminationRate: 0.8,
  femaleEliminationRate: 1.1,
  femaleWeight: 1800,
  evennessDegree: 85,
  femaleTibiaLength: 105,
  dailyConsumption: 115,
  maleWeight: 2500,
  maleTibiaLength: 125,
  eggWeight: 62,
  layingRateStart: 0.75,
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
  return { api: createProductSettingChickenProductionCapability(request), calls }
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
  const api = createProductSettingChickenProductionCapability(
    config => call(PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 标准库管理 → 种鸡生产指标标准页面能力', () => {
  it('逐页锁定菜单、product实例、权限、列表动作、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/chicken-production/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/chicken-production/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/ChickenProductionController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/standard/ChickenProduction.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/ChickenProductionServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/standard/ChickenProductionMapperExt.xml')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_CHICKEN_PRODUCTION_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_CHICKEN_PRODUCTION_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_CHICKEN_PRODUCTION_SUBMIT_PERMISSION}'`,
      "http.get('/base/chickenProduction/page'",
      "http.post('/base/chickenProduction/save'",
      "http.delete(`/base/chickenProduction/${record.id}`)",
      'v-if="permissionCheck(permissions.submit)"',
      'styleV2: true',
      'weekAge: 0',
      'moulting: 0',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "year: [{ required: true",
      "moulting: [{ required: true",
      "weekAge: [{ required: true",
      'passRate: Number(formState.passRate) / 100',
      'layingRate: Number(formState.layingRate) / 100',
      '...props.raw',
    ]) expect(modal).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("flockSimu/base/chickenProduction")',
      '@GetMapping("page")',
      '@PostMapping("save")',
      '@DeleteMapping("{id}")',
      'PageParam.responsePage(resultList)',
      'multiplyNumHandle(dto, 100)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['layingRate', 'passRate', 'fertilityRate', 'maleDeathsRate', 'femaleDeathsRate', 'femaleWeight', 'eggWeight']) expect(entity).toContain(field)
    for (const fragment of ['updateByPrimaryKeySelective(chickenProduction)', 'insertSelective(chickenProduction)', 'chickenProduction.setDelFlag(1)']) expect(service).toContain(fragment)
    for (const fragment of ['AND week_age=#{weekAge}', 'AND gen=#{gen}', 'AND variety=#{variety}', 'AND line=#{line}', 'AND `year`=#{year}', 'AND moulting=#{moulting}', 'del_flag = 0']) expect(mapper).toContain(fragment)
  })

  it('列表按Portal customLoad发送完整查询，保留服务端已乘100的率字段', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ year: 2026, weekAge: 12, gen: 'G1', line: 'L1', variety: 'V1', moulting: 1, pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ layingRate: 82, passRate: 96, rawExtension: 'preserved-on-update' })] })
    expect(f.calls).toEqual([{
      url: '/base/chickenProduction/page',
      method: 'get',
      params: { order: '', orderField: '', year: '2026', weekAge: 12, gen: 'G1', line: 'L1', variety: 'V1', moulting: 1, pageNo: 2, pageSize: 50 },
    }])
    const defaults = fixture([{ page: { list: [], total: 0 } }])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', year: '', weekAge: 0, gen: '', line: '', variety: '', moulting: 0, pageNo: 1, pageSize: 20 })
  })

  it('新建按Portal表单规则把百分数除以100后提交', async () => {
    const f = fixture([{}])
    const prepared = f.api.prepareCreate(form)
    expect(prepared.draft).toMatchObject({ year: 2026, moulting: 1, weekAge: 12, layingRate: 0.82, passRate: 0.96, fertilityRate: 0.94, femaleWeight: 1800 })
    await expect(f.api.create(prepared)).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/base/chickenProduction/save', method: 'post', data: prepared.draft }])
  })

  it('编辑保留Portal raw扩展字段并只覆盖编辑字段，删除使用路径参数', async () => {
    const f = fixture([{}, {}])
    const editForm = { ...form, ...row, passRate: 97, id: row.id }
    const prepared = f.api.prepareUpdate(editForm)
    expect(prepared.draft).toMatchObject({ id: row.id, rawExtension: 'preserved-on-update', passRate: 0.97, layingRate: 0.82, layingRateStart: 0.75 })
    await expect(f.api.update(prepared)).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/base/chickenProduction/save', method: 'post', data: prepared.draft },
      { url: `/base/chickenProduction/${row.id}`, method: 'delete' },
    ])
  })

  it('坏输入、坏分页和坏响应不会静默降级或发请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, year: undefined as never })).toThrow('年度')
    expect(() => f.api.prepareCreate({ ...form, moulting: 2 as never })).toThrow('0（非换羽）或1（换羽）')
    expect(() => f.api.prepareCreate({ ...form, passRate: 10_000_001 })).toThrow('合格率')
    expect(() => f.api.prepareCreate({ ...form, lineVer: 0 })).toThrow('品系版本')
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
    expect(captured.calls[0]?.url).toBe('/base/chickenProduction/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(productSettingChickenProductionCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_CHICKEN_PRODUCTION_METHODS))
    expect(productSettingChickenProductionCapabilities.every(item => item.pagePath === PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH && item.permission === PRODUCT_SETTING_CHICKEN_PRODUCTION_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_CHICKEN_PRODUCTION_MODULE_TYPE)).toBe(true)
    expect(AI_CONTRACTS['product-setting-chicken-production-list']).toBe(contracts['product-setting-chicken-production-list'])
    expect(METHOD_CONTRACTS['productSettingChickenProduction.list']).toBe(methodContracts['productSettingChickenProduction.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-chicken-production-prepare-create' && item.sdkPath === 'productSettingChickenProduction.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-chicken-production-prepare-remove' && item.sdkPath === 'productSettingChickenProduction.prepareRemove')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-chicken-production-remove' && item.sdkPath === 'productSettingChickenProduction.remove')).toBe(true)
    expect(contracts['product-setting-chicken-production-create']?.steps[0]?.capabilityId).toBe('product-setting-chicken-production-list')
    expect(contracts['product-setting-chicken-production-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_CHICKEN_PRODUCTION_SUBMIT_PERMISSION)
  })
})
