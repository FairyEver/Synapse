import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingDayLiquidationCapability,
  PRODUCT_SETTING_DAY_LIQUIDATION_METHODS,
  PRODUCT_SETTING_DAY_LIQUIDATION_MODULE_TYPE,
  PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH,
  PRODUCT_SETTING_DAY_LIQUIDATION_PERMISSION,
  productSettingDayLiquidationCapabilities,
} from '../src/capabilities/product-setting-day-liquidation.js'
import { PRODUCT_SETTING_DAY_LIQUIDATION_AI_CONTRACTS as contracts, PRODUCT_SETTING_DAY_LIQUIDATION_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-setting-day-liquidation.js'

type RequestConfig = Parameters<PortalRequest>[0]

const query = {
  type: 4 as const,
  farm: 'farm-1',
  building: 'building-1',
  businessId: 'B-001__group-1',
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  pageNo: 2,
  pageSize: 50 as const,
}

const row = {
  farm: null,
  farmName: '一场',
  typeName: '雏鸡日记录',
  recordDate: '2026-09-01',
  opDate: '2026-09-03',
  name: '张三',
  disparityDay: 2,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingDayLiquidationCapability(request), calls }
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
  const api = createProductSettingDayLiquidationCapability(
    config => call(PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 产品设置 → 日清日结页面能力', () => {
  it('逐页锁定菜单、product实例、权限、类型联动、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/day-liquidation.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/day-liquidation/list.vue')
    const farm = read(portalRoot, 'app/portal/components/portal/product/select/farm/index.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const main = read(portalRoot, 'app/portal/main.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/DayLiquidationController.java')
    const listVo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/vo/DayLiquidationListVO.java')
    const batchVo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/measure/vo/FlockMeasureListVO.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/base/DayLiquidationListDTO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/DayLiquidationServiceImpl.java')
    const hatchMapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/HatchMapperExt.xml')
    const diaryMapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/FlockDiaryMapperExt.xml')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_DAY_LIQUIDATION_PERMISSION}'`)
    expect(route).toContain('title: 日清日结')
    expect(route).toContain(PRODUCT_SETTING_DAY_LIQUIDATION_PERMISSION)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "import { useListPageModule } from 'common/libs/renren/list.js'",
      '{ label: \'入孵\', value: 1 }',
      '{ label: \'雏鸡日记录\', value: 4 }',
      'type: undefined',
      'farm: null',
      'businessId: null',
      "type: [{ required: true, message: '请选择类型', trigger: 'change' }]",
      "farm: [{ required: true, message: '请选择场区', trigger: 'change' }]",
      "businessId: [{ required: true, message: '请选择批次号', trigger: 'change' }]",
      "url: '/base/dayLiquidation/list'",
      "url: '/config/building/getByFarmId'",
      "url: '/base/dayLiquidation/getBatchAndSex'",
      "data.businessId = data.businessId.split('__')[1]",
      'scope: 1',
      'const typeMap = { 1: 3, 2: 3, 3: 3, 4: 1, 5: 2 }',
      'getDataListIsPage: true',
      'keyId: \'id\'',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'typeList: { type: String, default: \'3\' }',
      'authList: { type: String, default: \'1\' }',
      "http('/config/farm/getFarmByQuery'",
      'value: Number(e.id)',
      'label: e.fullName',
    ]) expect(farm).toContain(fragment)
    for (const fragment of [
      'const params = computed(() => {',
      'typeList: props.typeList',
      'authList: props.authList',
    ]) expect(farm).toContain(fragment)
    expect(main).toContain("fieldNamePageSize: 'pageSize'")
    for (const fragment of [
      'const params = {',
      'order: orderType.value',
      'orderField: orderField.value',
      'params[fieldNamePageNo] = pageNo.value',
      'params[fieldNamePageSize] = pageSize.value',
    ]) expect(renrenList).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/base/dayLiquidation")',
      '@GetMapping(value = "/getBatchAndSex")',
      '@GetMapping(value = "/list")',
      'putData("list", list)',
      'putData("page", page)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['scope', 'farm', 'type', 'building', 'businessId', 'startDate', 'endDate']) expect(listVo).toContain(field)
    for (const field of ['scope', 'farm', 'building', 'businessId', 'type']) expect(batchVo).toContain(field)
    for (const field of ['farmName', 'typeName', 'recordDate', 'opDate', 'name', 'disparityDay']) expect(dto).toContain(field)
    for (const fragment of [
      'if(flockWeightListVO.getType()>3)',
      'hatch.setHall(flockWeightListVO.getFarm())',
      'getDayLiquidationListPageWithPageHelper',
      'getDistanceDayOfTwoDate(dayLiquidationListDTO.getRecordDate(),dayLiquidationListDTO.getOpDate())',
      'map.put("batch",hatch.getBatch())',
      'map.put("groupId",hatch.getFlockGroupId())',
    ]) expect(service).toContain(fragment)
    for (const fragment of [
      'id="selectDayLiquidationSittingEggListPage"',
      'id="selectDayLiquidationCandlingListPage"',
      'id="selectDayLiquidationOutshellListPage"',
      'AND sh.batch = #{businessId}',
    ]) expect(hatchMapper).toContain(fragment)
    for (const fragment of [
      'id="selectDayLiquidationListPage"',
      'sfd.flock_group_id = #{businessId}',
      'sfd.scope = #{scope}',
    ]) expect(diaryMapper).toContain(fragment)

    expect(productSettingDayLiquidationCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_DAY_LIQUIDATION_METHODS))
    expect(productSettingDayLiquidationCapabilities.every(item => item.pagePath === PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH && item.permission === PRODUCT_SETTING_DAY_LIQUIDATION_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_DAY_LIQUIDATION_MODULE_TYPE)).toBe(true)
  })

  it('列表、栋号和批次联动按Portal逐字段发送', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }, [{ id: 'building-1', shortName: '1栋' }], [{ batch: 'B-001', groupId: 'group-1', sexName: '母鸡' }]])
    await expect(f.api.list(query)).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.buildingList({ farmId: 'farm-1' })).resolves.toEqual([{ value: 'building-1', label: '1栋' }])
    await expect(f.api.batchList({ type: 4, farm: 'farm-1', building: 'building-1' })).resolves.toEqual([{ value: 'B-001__group-1', label: 'B-001' }])
    expect(f.calls).toEqual([
      {
        url: '/base/dayLiquidation/list',
        method: 'get',
        params: { order: '', orderField: '', type: 4, farm: 'farm-1', building: 'building-1', businessId: 'group-1', startDate: '2026-09-01', endDate: '2026-09-30', scope: 1, pageNo: 2, pageSize: 50 },
      },
      { url: '/config/building/getByFarmId', method: 'get', params: { farmId: 'farm-1' } },
      { url: '/base/dayLiquidation/getBatchAndSex', method: 'get', params: { farm: 'farm-1', type: 4, building: 'building-1', scope: 1 } },
    ])
  })

  it('类型、场区、批次、日期、分页和坏响应在发请求前或响应处失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ ...query, type: 6 as never })).rejects.toThrow('类型')
    await expect(f.api.list({ ...query, farm: '' })).rejects.toThrow('场区')
    await expect(f.api.list({ ...query, businessId: 'B-001' })).rejects.toThrow('批次组ID')
    await expect(f.api.list({ ...query, startDate: '2026-02-30' })).rejects.toThrow('YYYY-MM-DD')
    await expect(f.api.list({ ...query, pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.buildingList({ farmId: '' })).rejects.toThrow('ID')
    await expect(f.api.batchList({ type: 5, farm: '' })).rejects.toThrow('场区')
    expect(f.calls).toEqual([])

    await expect(fixture([{ page: { list: [{ ...row, disparityDay: '2' }], total: 1 } }]).api.list(query)).rejects.toThrow('disparityDay')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list(query)).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ batch: 'B-001', groupId: null }] }]).api.batchList({ type: 4, farm: 'farm-1' })).rejects.toThrow('groupId')
    await expect(fixture([{ list: [{ id: 'building-1' }] }]).api.buildingList({ farmId: 'farm-1' })).rejects.toThrow('shortName')
    await expect(fixture([new Error('无权限')]).api.list(query)).rejects.toThrow('无权限')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list(query)).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/base/dayLiquidation/list')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖页面的三个只读方法、权限和后端差异', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_DAY_LIQUIDATION_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_DAY_LIQUIDATION_METHODS).map(method => `productSettingDayLiquidation.${method}`).sort())
    expect(contracts['product-setting-day-liquidation-list']?.effect).toBe('read')
    expect(contracts['product-setting-day-liquidation-list']?.inputs.businessId?.constraints).toContain('必须包含非空的__第二段')
    expect(contracts['product-setting-day-liquidation-list']?.boundaries.join('\n')).toContain('按sh.batch筛选')
    expect(contracts['product-setting-day-liquidation-batch-list']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['[].value', '[].label']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingDayLiquidationCapabilities, contracts })).toEqual([])
  })
})
