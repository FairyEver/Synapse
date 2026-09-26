import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingStandardBroilerCapability,
  PRODUCT_SETTING_STANDARD_BROILER_METHODS,
  PRODUCT_SETTING_STANDARD_BROILER_MODULE_TYPE,
  PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_BROILER_PERMISSION,
  PRODUCT_SETTING_STANDARD_BROILER_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_BROILER_SUBMIT_PERMISSION,
  productSettingStandardBroilerCapabilities,
  type ProductSettingStandardBroilerCreateForm,
} from '../src/capabilities/product-setting-standard-broiler.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_STANDARD_BROILER_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_STANDARD_BROILER_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-standard-broiler.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingStandardBroilerCreateForm = {
  year: 2026,
  type: 7,
  age: 21,
  variety: 'V1',
  totalConsumeMaterialStandard: 2400,
  totalSurvivalRateStandard: 85,
  deathEliminateStandard: 2,
  consumeMaterialStandard: 120,
  feedMeatRatioStandard: 1.6,
  avgWeightStandard: 2200,
}

const row = {
  id: 'standard-broiler-1',
  year: 2026,
  type: 7,
  age: 21,
  gen: 'G1',
  variety: 'V1',
  varietyName: null,
  line: 'L1',
  totalConsumeMaterialStandard: 2400,
  totalSurvivalRateStandard: 85,
  deathEliminateStandard: 2,
  consumeMaterialStandard: 120,
  feedMeatRatioStandard: 1.6,
  avgWeightStandard: 2200,
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
  return { api: createProductSettingStandardBroilerCapability(request), calls }
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
  const api = createProductSettingStandardBroilerCapability(config => call(PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH, { ...config, httpInstance: 'product' }))
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 标准库管理 → 肉鸡标准页面能力', () => {
  it('逐页锁定菜单、路由、product实例、权限、列表/弹窗和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-broiler.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-broiler/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-broiler/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/StandardBroilerController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/standard/BroilerFlock.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/base/BroilerFlockDTO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/StandardBroilerServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/standard/BroilerFlockMapperExt.xml')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_STANDARD_BROILER_PERMISSION}'`)
    expect(route).toContain(`permission: ${PRODUCT_SETTING_STANDARD_BROILER_PERMISSION}`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_STANDARD_BROILER_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_STANDARD_BROILER_SUBMIT_PERMISSION}'`,
      "http.get('/base/standardBroiler/page'",
      "http.post('/base/standardBroiler/save'",
      "http.delete(`/base/standardBroiler/${record.id}`)",
      'v-if="permissionCheck(permissions.submit)"',
      'year: \'\'',
      'type: \'\'',
      'age: \'\'',
      'variety: \'\'',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "year: [{ required: true",
      "age: [{ required: true",
      'totalSurvivalRateStandard: Number(formState.totalSurvivalRateStandard) / 100',
      'formState.type = props.raw.type || \'1\'',
      '...props.raw',
    ]) expect(modal).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("flockSimu/base/standardBroiler")',
      '@GetMapping("page")',
      '@PostMapping("save")',
      '@DeleteMapping("{id}")',
      'PageParam.responsePage(resultList)',
      'setTotalSurvivalRateStandard(CalculationFormula.multiplyNum',
    ]) expect(controller).toContain(fragment)
    for (const field of ['Integer year', 'Integer type', 'Integer age', 'String variety', 'BigDecimal totalConsumeMaterialStandard', 'BigDecimal totalSurvivalRateStandard', 'Integer deathEliminateStandard', 'BigDecimal consumeMaterialStandard', 'BigDecimal feedMeatRatioStandard', 'BigDecimal avgWeightStandard']) expect(entity).toContain(field)
    expect(dto).toContain('varietyName')
    for (const fragment of ['updateByPrimaryKeySelective(broilerFlock)', 'insertSelective(broilerFlock)', 'setDelFlag(1)']) expect(service).toContain(fragment)
    for (const fragment of ['AND age=#{age}', 'AND variety=#{variety}', 'AND year=#{year}', 'AND type=#{type}', 'del_flag = 0']) expect(mapper).toContain(fragment)
  })

  it('列表按Portal筛选和分页发送，保留服务端存活率响应值', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ year: 2026, type: 7, age: '21', variety: 'V1', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{
      url: '/base/standardBroiler/page',
      method: 'get',
      params: { order: '', orderField: '', year: '2026', type: 7, age: '21', variety: 'V1', pageNo: 2, pageSize: 50 },
    }])
    const defaults = fixture([{ page: { list: [], total: 0 } }])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', year: '', type: '', age: '', variety: '', pageNo: 1, pageSize: 20 })
  })

  it('新建和编辑按Portal规则把存活率除以100，保留raw，删除使用路径参数', async () => {
    const f = fixture([{}, {}])
    const prepared = f.api.prepareCreate(form)
    expect(prepared.draft).toMatchObject({ year: 2026, type: 7, age: 21, variety: 'V1', totalSurvivalRateStandard: 0.85, avgWeightStandard: 2200 })
    await expect(f.api.create(prepared)).resolves.toBe(true)
    const update = f.api.prepareUpdate({ ...row, ...form, id: row.id })
    expect(update.draft).toMatchObject({ id: row.id, totalSurvivalRateStandard: 0.85, rawExtension: 'preserved-on-update' })
    await expect(f.api.update(update)).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/base/standardBroiler/save', method: 'post', data: prepared.draft },
      { url: '/base/standardBroiler/save', method: 'post', data: update.draft },
      { url: `/base/standardBroiler/${row.id}`, method: 'delete' },
    ])
  })

  it('坏输入、坏分页和坏响应不会静默降级或发请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, year: 1969 })).toThrow('年度')
    expect(() => f.api.prepareCreate({ ...form, age: -1 })).toThrow('日龄/周龄')
    expect(() => f.api.prepareCreate({ ...form, type: 2 as never })).toThrow('类型')
    expect(() => f.api.prepareCreate({ ...form, totalSurvivalRateStandard: 10_000_001 })).toThrow('累计存活率标准')
    expect(() => f.api.prepareUpdate({ ...form, id: '' })).toThrow('ID')
    await expect(f.api.list({ type: 2 })).rejects.toThrow('类型筛选')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])
    await expect(fixture([{ page: { list: [{ ...row, type: 3 }], total: 1 } }]).api.list()).rejects.toThrow('.type')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例追加devicetype，当前页面不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ id: row.id })] })
    expect(captured.calls[0]?.url).toBe('/base/standardBroiler/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(productSettingStandardBroilerCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_STANDARD_BROILER_METHODS))
    expect(productSettingStandardBroilerCapabilities.every(item => item.pagePath === PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH && item.permission === PRODUCT_SETTING_STANDARD_BROILER_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_STANDARD_BROILER_MODULE_TYPE)).toBe(true)
    expect(AI_CONTRACTS['product-setting-standard-broiler-list']).toBe(contracts['product-setting-standard-broiler-list'])
    expect(METHOD_CONTRACTS['productSettingStandardBroiler.list']).toBe(methodContracts['productSettingStandardBroiler.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-broiler-prepare-create' && item.sdkPath === 'productSettingStandardBroiler.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-broiler-prepare-remove' && item.sdkPath === 'productSettingStandardBroiler.prepareRemove')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-broiler-remove' && item.sdkPath === 'productSettingStandardBroiler.remove')).toBe(true)
    expect(contracts['product-setting-standard-broiler-create']?.steps[0]?.capabilityId).toBe('product-setting-standard-broiler-list')
    expect(contracts['product-setting-standard-broiler-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_STANDARD_BROILER_SUBMIT_PERMISSION)
  })
})
