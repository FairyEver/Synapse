import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingSeasonCapability,
  PRODUCT_SETTING_SEASON_METHODS,
  PRODUCT_SETTING_SEASON_MODULE_TYPE,
  PRODUCT_SETTING_SEASON_PAGE_PATH,
  PRODUCT_SETTING_SEASON_PERMISSION,
  productSettingSeasonCapabilities,
  type ProductSettingSeasonDateRangeForm,
} from '../src/capabilities/product-setting-season.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_SEASON_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_SEASON_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-season.js'

type RequestConfig = Parameters<PortalRequest>[0]

const fullRange = { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 }
const band = {
  tempBandId: 'tb-1',
  bandCode: 'T1',
  bandName: '温度段一',
  lowerTemp: 18,
  upperTemp: 24,
  sortNo: 1,
  status: 1,
  dateRanges: [fullRange],
}
const row = {
  areaCode: '360102',
  provinceCode: '360000',
  provinceName: '江西省',
  cityCode: '360100',
  cityName: '南昌市',
  districtCode: '360102',
  districtName: '东湖区',
  tempBandCount: 1,
  operatorId: '7',
  operatorName: '测试用户',
  operationTime: '2026-09-24 10:00:00',
  status: 1,
  remarks: null,
  tempBands: [band],
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingSeasonCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function capturePlatform () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [row], total: 1 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
    { baseUrls: { platform: 'https://biz-api-test.wodecorp.cn' } },
  )
  const api = createProductSettingSeasonCapability(
    config => call(PRODUCT_SETTING_SEASON_PAGE_PATH, { ...config, httpInstance: 'platform' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 养殖预案 → 温度配置-新页面能力', () => {
  it('逐页锁定菜单、权限、platform实例、依赖请求、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/season/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/season/components/TemperatureModalContent.vue')
    const utils = read(portalRoot, 'app/portal/views/dashboard/product/setting/season/utils.js')
    const apiDoc = read(javaRoot, 'erp-module-fm/docs/新版预案/温度配置-PC端接口对接文档.md')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/RearingPlanAreaTempConfigController.java')
    const saveVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanAreaTempConfigSaveReqVO.java')
    const pageVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanAreaTempConfigPageReqVO.java')
    const responseVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanAreaTempConfigRespVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/rearingplan/impl/RearingPlanAreaTempConfigServiceImpl.java')
    const tempBandController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/RearingPlanTempBandController.java')
    const areaController = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/ip/AreaController.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_SEASON_PAGE_PATH}'`)
    expect(menu).toContain(`title: '温度配置-新'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_SEASON_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      'permissionCheck(PAGE_PERMISSION)',
      'getDataListIsPage: true',
      'deleteIsBatch: true',
      'selectCrossPage: false',
      'idKey: \'areaCode\'',
      'rrList.pageSize = 10',
      'http.get(`${AREA_TEMP_CONFIG_API}/page`',
      'http.get(`${AREA_TEMP_CONFIG_API}/get`',
      'http.put(`${AREA_TEMP_CONFIG_API}/save`',
      'http.delete(`${AREA_TEMP_CONFIG_API}/delete`',
      'delete-list?${query}',
      'params: { pageNo: 1, pageSize: 5, status: 1 }',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "export const AREA_TREE_API = '/system/area/tree'",
      "export const TEMP_BAND_API = '/flockSimu/rearingPlan/tempBand'",
      "export const AREA_TEMP_CONFIG_API = '/flockSimu/rearingPlan/areaTempConfig'",
      "export const PAGE_PERMISSION = '/dashboard/frame/breeding-plan-new/season'",
      'getAreaCode(formState)',
      'isValidDateRange(dateRange)',
      'normalizeTempBands',
    ]) expect(utils).toContain(fragment)
    for (const fragment of [
      'provinceCode: [{ required: true',
      '请至少配置一个温度段日期范围',
      '请配置有效的温度段日期范围',
      'getAreaCode(formState)',
      'modalEmit(\'submit\', toAreaTempConfigPayload(formState))',
    ]) expect(modal).toContain(fragment)
    for (const fragment of [
      'GET /system/area/tree',
      'GET /flockSimu/rearingPlan/tempBand/page?pageNo=1&pageSize=5&status=1',
      'GET /flockSimu/rearingPlan/areaTempConfig/page?pageNo=1&pageSize=10',
    ]) expect(apiDoc).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("flockSimu/rearingPlan/areaTempConfig")',
      '@PutMapping("/save")',
      '@GetMapping("/get")',
      '@GetMapping("/page")',
      '@DeleteMapping("/delete")',
      '@DeleteMapping("/delete-list")',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['@Pattern(regexp = "^\\\\d{6}$"', '@NotEmpty', '@Size(max = 5', '@NotBlank', '@NotNull', 'private List<@Valid DateRange> dateRanges']) expect(saveVO).toContain(fragment)
    for (const fragment of ['private String provinceCode', 'private String cityCode', 'private String districtCode']) expect(pageVO).toContain(fragment)
    for (const fragment of ['private String areaCode', 'private String provinceCode', 'private String operatorName', 'private List<TempBandConfig> tempBands', 'private Integer startMonth']) expect(responseVO).toContain(fragment)
    for (const fragment of ['validateAreaHierarchy', 'collectConfiguredBands', 'validateTempBandsContinuous', 'validateFullYearCoverage', '温度段不能重复配置', '日期范围不能重叠', '日期范围必须完整覆盖全年', 'deleteAreaTempConfigList']) expect(service).toContain(fragment)
    for (const fragment of ['@RequestMapping("flockSimu/rearingPlan/tempBand")', '@GetMapping("/page")']) expect(tempBandController).toContain(fragment)
    for (const fragment of ['@RequestMapping("/system/area")', '@GetMapping("/tree")']) expect(areaController).toContain(fragment)

    expect(productSettingSeasonCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_SEASON_METHODS))
    expect(productSettingSeasonCapabilities.every(item => item.pagePath === PRODUCT_SETTING_SEASON_PAGE_PATH && item.permission === PRODUCT_SETTING_SEASON_PERMISSION && item.httpInstance === 'platform' && item.moduleType === PRODUCT_SETTING_SEASON_MODULE_TYPE)).toBe(true)
  })

  it('按Portal顺序读取地区树、启用温度段和规范化结果', async () => {
    const f = fixture([
      [{ id: 360000, name: '省', children: [{ id: 360100, name: '市', children: [] }] }],
      { page: { records: [{ ...band, temp_band_id: undefined }], total: 1 } },
    ])
    await expect(f.api.areaTree()).resolves.toEqual([{ id: '360000', name: '省', children: [{ id: '360100', name: '市', children: [] }] }])
    await expect(f.api.tempBandList()).resolves.toMatchObject([{ tempBandId: 'tb-1', sortNo: 1, dateRanges: [{ startMonth: 1, endDay: 31 }] }])
    expect(f.calls).toEqual([
      { url: '/system/area/tree', method: 'get' },
      { url: '/flockSimu/rearingPlan/tempBand/page', method: 'get', params: { pageNo: 1, pageSize: 5, status: 1 } },
    ])
  })

  it('列表按页面层级筛选、分页和Java响应发送参数', async () => {
    const f = fixture([{ page: { records: [row], total: 1 } }])
    await expect(f.api.list({ provinceCode: ' 360000 ', cityCode: '360100', districtCode: '360102', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ areaCode: '360102', tempBandCount: 1 })] })
    expect(f.calls).toEqual([{ url: '/flockSimu/rearingPlan/areaTempConfig/page', method: 'get', params: { pageNo: 2, pageSize: 50, provinceCode: '360000', cityCode: '360100', districtCode: '360102' } }])
    await expect(fixture([]).api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(fixture([]).api.list({ cityCode: 'bad' })).rejects.toThrow('6位')
  })

  it('prepareSave复刻地区优先级、只提交必要字段和全年日期规则', async () => {
    const f = fixture([true])
    const prepared = f.api.prepareSave({
      provinceCode: '360000',
      cityCode: '360100',
      districtCode: '360102',
      status: 0,
      remarks: 'Portal不会提交',
      tempBands: [{ ...band, dateRanges: [fullRange] }, { tempBandId: 'tb-2', sortNo: 2, dateRanges: [] }],
    })
    expect(prepared).toEqual({
      draft: {
        areaCode: '360102',
        tempBands: [
          { tempBandId: 'tb-1', dateRanges: [fullRange] },
          { tempBandId: 'tb-2', dateRanges: [] },
        ],
      },
    })
    await expect(f.api.save(prepared)).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/flockSimu/rearingPlan/areaTempConfig/save', method: 'put', data: prepared.draft }])
    expect(() => f.api.prepareSave({ provinceCode: '', tempBands: [{ tempBandId: 'tb-1', dateRanges: [fullRange] }] })).toThrow('行政区编码')
    expect(() => f.api.prepareSave({ cityCode: '360100', tempBands: [{ tempBandId: 'tb-1', dateRanges: [fullRange] }] })).toThrow('先选择省')
  })

  it('保存前阻止Portal日期错误、空配置、重复温度段、重叠和不连续温度段', () => {
    const f = fixture([])
    const form = (dateRanges: ProductSettingSeasonDateRangeForm[], overrides: Record<string, unknown> = {}) => ({ provinceCode: '360000', tempBands: [{ tempBandId: 'tb-1', sortNo: 1, dateRanges }], ...overrides })
    expect(() => f.api.prepareSave(form([{ ...fullRange, startMonth: 2, startDay: 29 }]))).toThrow('startDay')
    expect(() => f.api.prepareSave(form([]))).toThrow('至少需要配置')
    expect(() => f.api.prepareSave(form([{ startMonth: 1, startDay: 1, endMonth: 6, endDay: 30 }]))).toThrow('全年')
    expect(() => f.api.prepareSave(form([{ ...fullRange }, { startMonth: 1, startDay: 1, endMonth: 1, endDay: 1 }]))).toThrow('重叠')
    expect(() => f.api.prepareSave({ provinceCode: '360000', tempBands: [
      { tempBandId: 'tb-1', sortNo: 1, dateRanges: [{ startMonth: 1, startDay: 1, endMonth: 6, endDay: 30 }] },
      { tempBandId: 'tb-2', sortNo: 3, dateRanges: [{ startMonth: 7, startDay: 1, endMonth: 12, endDay: 31 }] },
    ] })).toThrow('连续')
    expect(() => f.api.prepareSave({ provinceCode: '360000', tempBands: [{ tempBandId: 'tb-1', dateRanges: [fullRange] }, { tempBandId: 'tb-1', dateRanges: [] }] })).toThrow('重复')
  })

  it('详情、单删和批量删除保持prepare→submit与精确URL', async () => {
    const f = fixture([row, true, true])
    await expect(f.api.get({ areaCode: ' 360102 ' })).resolves.toMatchObject({ areaCode: '360102', tempBands: [expect.objectContaining({ tempBandId: 'tb-1' })] })
    const remove = f.api.prepareRemove({ areaCode: '360102' })
    const removeBatch = f.api.prepareRemoveBatch({ areaCodes: ['360102', '360100', '360102'] })
    await expect(f.api.remove(remove)).resolves.toBe(true)
    await expect(f.api.removeBatch(removeBatch)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockSimu/rearingPlan/areaTempConfig/get', method: 'get', params: { areaCode: '360102' } },
      { url: '/flockSimu/rearingPlan/areaTempConfig/delete', method: 'delete', params: { areaCode: '360102' } },
      { url: '/flockSimu/rearingPlan/areaTempConfig/delete-list?areaCodes=360102&areaCodes=360100', method: 'delete' },
    ])
    expect(() => f.api.prepareRemove({ areaCode: '1' })).toThrow('6位')
    expect(() => f.api.prepareRemoveBatch({ areaCodes: [] })).toThrow('不能为空')
    expect(() => f.api.prepareRemoveBatch({ areaCodes: Array.from({ length: 51 }, (_, index) => String(index).padStart(6, '0')) })).toThrow('50')
  })

  it('平台实例按页面上下文发送admin-api前缀且不发送module-type/devicetype', async () => {
    const captured = capturePlatform()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1 })
    expect(captured.calls[0]?.url).toMatch(/^\/admin-api\/flockSimu\/rearingPlan\/areaTempConfig\/page\?pageNo=1&pageSize=10&_t=\d+$/)
    expect(captured.calls[0]?.headers?.get('module-type')).toBeUndefined()
    expect(captured.calls[0]?.headers?.get('devicetype')).toBeUndefined()
  })

  it('AI契约覆盖公开方法、提交体、权限、回查和源码证据，并已注册', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_SEASON_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_SEASON_METHODS).map(method => `productSettingSeason.${method}`).sort())
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['product-setting-season-save']?.boundaries.join('\n')).toContain('只发送areaCode和tempBands')
    expect(contracts['product-setting-season-prepare-save']?.gaps?.join('\n')).toContain('真实测试环境')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingSeasonCapabilities, contracts })).toEqual([])
  })

  it('通用invoke把prepare表单映射到SDK方法，并绑定批量删除', async () => {
    const f = fixture([])
    const saveBinding = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-season-prepare-save')
    const batchBinding = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-season-prepare-remove-batch')
    expect(saveBinding).toBeDefined()
    expect(batchBinding).toBeDefined()
    await expect(saveBinding!.run({ productSettingSeason: f.api } as never, { form: { provinceCode: '360000', tempBands: [{ tempBandId: 'tb-1', dateRanges: [fullRange] }] } })).resolves.toEqual({ draft: { areaCode: '360000', tempBands: [{ tempBandId: 'tb-1', dateRanges: [fullRange] }] } })
    await expect(batchBinding!.run({ productSettingSeason: f.api } as never, { areaCodes: ['360102', '360100'] })).resolves.toEqual({ areaCodes: ['360102', '360100'] })
  })
})
