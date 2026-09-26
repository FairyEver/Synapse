import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingStandardFlockWeekCapability,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHODS,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_MODULE_TYPE,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_SUBMIT_PERMISSION,
  productSettingStandardFlockWeekCapabilities,
  type ProductSettingStandardFlockWeekCreateForm,
} from '../src/capabilities/product-setting-standard-flock-week.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-standard-flock-week.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingStandardFlockWeekCreateForm = {
  year: 2026,
  weekAge: 12,
  variety: 'V1',
  line: 'L1',
  gen: 'G1',
  housed: 120,
  hatchingEggLayingRate: 82,
}

const row = {
  id: 'standard-flock-week-1',
  year: 2026,
  weekAge: 12,
  variety: 'V1',
  line: 'L1',
  gen: 'G1',
  housed: 120,
  hatchingEggLayingRate: 82,
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
  return { api: createProductSettingStandardFlockWeekCapability(request), calls }
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
  const api = createProductSettingStandardFlockWeekCapability(config => call(PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH, { ...config, httpInstance: 'product' }))
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 标准库管理 → 种鸡标准(BI)页面能力', () => {
  it('逐页锁定菜单、路由、product实例、权限、列表/弹窗和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-flock-week.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-flock-week/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-flock-week/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/StandardFlockWeekController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/standard/StandardFlockWeek.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/vo/StandardFlockWeekVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/StandardFlockWeekServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/standard/StandardFlockWeekMapperExt.xml')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION}'`)
    expect(route).toContain(`permission: ${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION}`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_SUBMIT_PERMISSION}'`,
      "http.get('/base/standardFlockWeek/page'",
      "http.post('/base/standardFlockWeek/save'",
      "http.delete(`/base/standardFlockWeek/${record.id}`)",
      'v-if="permissionCheck(permissions.submit)"',
      'year: \'\'',
      'gen: \'\'',
      'variety: \'\'',
      'line: \'\'',
      'startWeekAge: \'\'',
      'endWeekAge: \'\'',
      'rrList.convertFetchForm',
      'if (!params.startWeekAge) delete params.startWeekAge',
      'if (!params.endWeekAge) delete params.endWeekAge',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'year: [{ required: true',
      'weekAge: [{ required: true',
      'variety: [{ required: true',
      'line: [{ required: true',
      'gen: [{ required: true',
      'housed: [{ required: true',
      'hatchingEggLayingRate: [{ required: true',
      'hatchingEggLayingRate: Number(formState.hatchingEggLayingRate) / 100',
      '...props.raw',
    ]) expect(modal).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("flockSimu/base/standardFlockWeek")',
      '@GetMapping("{id}")',
      '@GetMapping("page")',
      '@PostMapping("save")',
      '@DeleteMapping("{id}")',
      'PageParam.responsePage(resultList)',
      'standardFlockWeekService.multiplyNumHandle(standard,100)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['String gen', 'String variety', 'String line', 'Integer weekAge', 'BigDecimal hatchingEggLayingRate', 'BigDecimal housed', 'Integer year']) expect(entity).toContain(field)
    for (const field of ['Integer startWeekAge', 'Integer endWeekAge']) expect(vo).toContain(field)
    for (const fragment of ['updateByPrimaryKeySelective(standardFlockWeek)', 'insertSelective(standardFlockWeek)', 'setDelFlag(1)']) expect(service).toContain(fragment)
    for (const fragment of [
      "del_flag = '0'",
      'AND `year` = #{year}',
      'AND gen = #{gen}',
      'AND variety = #{variety}',
      'AND line = #{line}',
      'AND week_age = #{weekAge}',
      'AND week_age &gt;=#{startWeekAge}',
      'AND week_age &lt;= #{endWeekAge}',
    ]) expect(mapper).toContain(fragment)
  })

  it('列表按Portal筛选和分页发送，空周龄范围不发参数', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ year: 2026, gen: 'G1', variety: 'V1', line: 'L1', startWeekAge: 10, endWeekAge: 20, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{
      url: '/base/standardFlockWeek/page',
      method: 'get',
      params: { order: '', orderField: '', year: '2026', gen: 'G1', variety: 'V1', line: 'L1', pageNo: 2, pageSize: 50, startWeekAge: 10, endWeekAge: 20 },
    }])
    const defaults = fixture([{ page: { list: [], total: 0 } }])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', year: '', gen: '', variety: '', line: '', pageNo: 1, pageSize: 20 })
    const emptyRange = fixture([{ page: { list: [], total: 0 } }])
    await expect(emptyRange.api.list({ startWeekAge: 0, endWeekAge: '' })).resolves.toEqual({ list: [], total: 0 })
    expect(emptyRange.calls[0]?.params).toEqual({ order: '', orderField: '', year: '', gen: '', variety: '', line: '', pageNo: 1, pageSize: 20 })
  })

  it('新建和编辑按Portal规则把产蛋率除以100，保留raw，删除使用路径参数', async () => {
    const f = fixture([{}, {}])
    const prepared = f.api.prepareCreate(form)
    expect(prepared.draft).toMatchObject({ year: 2026, weekAge: 12, variety: 'V1', line: 'L1', gen: 'G1', housed: 120, hatchingEggLayingRate: 0.82 })
    await expect(f.api.create(prepared)).resolves.toBe(true)
    const update = f.api.prepareUpdate({ ...row, ...form, id: row.id })
    expect(update.draft).toMatchObject({ id: row.id, hatchingEggLayingRate: 0.82, rawExtension: 'preserved-on-update' })
    await expect(f.api.update(update)).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/base/standardFlockWeek/save', method: 'post', data: prepared.draft },
      { url: '/base/standardFlockWeek/save', method: 'post', data: update.draft },
      { url: `/base/standardFlockWeek/${row.id}`, method: 'delete' },
    ])
  })

  it('七项必填、数值边界、分页、ID和坏响应不会静默降级或发请求', async () => {
    const f = fixture([])
    for (const field of ['year', 'weekAge', 'variety', 'line', 'gen', 'housed', 'hatchingEggLayingRate'] as const) {
      expect(() => f.api.prepareCreate({ ...form, [field]: '' })).toThrow()
    }
    expect(() => f.api.prepareCreate({ ...form, year: 10_000_001 })).toThrow('年度')
    expect(() => f.api.prepareCreate({ ...form, hatchingEggLayingRate: -10_000_001 })).toThrow('合格种蛋产蛋率标准')
    expect(() => f.api.prepareUpdate({ ...form, id: '' })).toThrow('ID')
    await expect(f.api.list({ startWeekAge: 201 })).rejects.toThrow('开始周龄')
    await expect(f.api.list({ endWeekAge: 0.5 })).rejects.toThrow('结束周龄')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])
    await expect(fixture([{ page: { list: [{ ...row, hatchingEggLayingRate: 'bad' }], total: 1 } }]).api.list()).rejects.toThrow('.hatchingEggLayingRate')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例追加devicetype，当前页面不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ id: row.id })] })
    expect(captured.calls[0]?.url).toBe('/base/standardFlockWeek/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(productSettingStandardFlockWeekCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHODS))
    expect(productSettingStandardFlockWeekCapabilities.every(item => item.pagePath === PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH && item.permission === PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_STANDARD_FLOCK_WEEK_MODULE_TYPE)).toBe(true)
    expect(AI_CONTRACTS['product-setting-standard-flock-week-list']).toBe(contracts['product-setting-standard-flock-week-list'])
    expect(METHOD_CONTRACTS['productSettingStandardFlockWeek.list']).toBe(methodContracts['productSettingStandardFlockWeek.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-flock-week-prepare-create' && item.sdkPath === 'productSettingStandardFlockWeek.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-flock-week-prepare-remove' && item.sdkPath === 'productSettingStandardFlockWeek.prepareRemove')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-flock-week-remove' && item.sdkPath === 'productSettingStandardFlockWeek.remove')).toBe(true)
    expect(contracts['product-setting-standard-flock-week-create']?.steps[0]?.capabilityId).toBe('product-setting-standard-flock-week-list')
    expect(contracts['product-setting-standard-flock-week-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_STANDARD_FLOCK_WEEK_SUBMIT_PERMISSION)
  })
})
