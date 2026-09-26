import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingStandardHatchCapability,
  PRODUCT_SETTING_STANDARD_HATCH_METHODS,
  PRODUCT_SETTING_STANDARD_HATCH_MODULE_TYPE,
  PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_HATCH_PERMISSION,
  PRODUCT_SETTING_STANDARD_HATCH_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_HATCH_SUBMIT_PERMISSION,
  productSettingStandardHatchCapabilities,
  type ProductSettingStandardHatchCreateForm,
} from '../src/capabilities/product-setting-standard-hatch.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_STANDARD_HATCH_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_STANDARD_HATCH_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-standard-hatch.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingStandardHatchCreateForm = {
  year: 2026,
  ageStage: 'age-1',
  gen: 'G1',
  hall: 101,
  variety: 'V1',
  genDown: 1,
  healthyFemaleRate: 82,
  abnormalFemaleRate: 60,
  eggChickRatio: 1.25,
  chickWeight: 42,
  fertilizedHatchingRate: 90,
  excludedBloodFertilityRate: 88,
  satisfaction: 95,
}

const row = {
  id: 'standard-hatch-1',
  year: 2026,
  ageStage: 'age-1',
  gen: 'G1',
  hall: '101',
  hallName: null,
  variety: 'V1',
  genDown: 1,
  healthyFemaleRate: 82,
  abnormalFemaleRate: 60,
  eggChickRatio: 1.25,
  chickWeight: 42,
  fertilizedHatchingRate: 90,
  excludedBloodFertilityRate: 88,
  satisfaction: 95,
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
  return { api: createProductSettingStandardHatchCapability(request), calls }
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
    const isOptions = config.url === '/egg/standardAgeStage/list'
    return {
      data: isOptions
        ? { ret: 'SUCCESS', code: 0, msg: '', data: { list: [{ id: 'age-1', stage: '1-7日龄' }] } }
        : { ret: 'SUCCESS', code: 0, msg: '', data: { page: { list: [row], total: 1 } } },
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
  const api = createProductSettingStandardHatchCapability(config => call(PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH, { ...config, httpInstance: 'product' }))
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 标准库管理 → 孵化健母率标准页面能力', () => {
  it('逐页锁定菜单、路由、product实例、权限、列表/弹窗、选项和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-hatch.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-hatch/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/standard-hatch/modal-form-content.vue')
    const farm = read(portalRoot, 'app/portal/components/portal/product/select/farm/index.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/StandardHatchController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/standard/StandardHatch.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/StandardHatchServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/standard/StandardHatchMapperExt.xml')
    const standardAgeStageController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/hatch/StandardAgeStageController.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_STANDARD_HATCH_PERMISSION}'`)
    expect(route).toContain(`permission: ${PRODUCT_SETTING_STANDARD_HATCH_PERMISSION}`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_STANDARD_HATCH_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_STANDARD_HATCH_SUBMIT_PERMISSION}'`,
      "http.get('/base/standardHatch/page'",
      "http.get('/egg/standardAgeStage/list'",
      "http.post('/base/standardHatch/save'",
      "http.delete(`/base/standardHatch/${record.id}`)",
      'v-if="permissionCheck(permissions.submit)"',
      'ageStage: \'\'',
      'hall: \'\'',
      'gen: \'\'',
      'variety: \'\'',
      'year: \'\'',
      'genDown: 0',
      'rules: {',
      'hall: [{ required: true',
      'genDown: [{ required: true',
      'handleHallAfterLoad',
      'getHallLabel(record.hall, record.hallName)',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'year: [{ required: true',
      'ageStage: [{ required: true',
      'gen: [{ required: true',
      'hall: [{ required: true',
      'variety: [{ required: true',
      'genDown: [{ required: true',
      'healthyFemaleRate: [{ required: true',
      'eggChickRatio: [{ required: true',
      'chickWeight: [{ required: true',
      'fertilizedHatchingRate: [{ required: true',
      'excludedBloodFertilityRate: [{ required: true',
      'satisfaction: [{ required: true',
      'healthyFemaleRate: Number(formState.healthyFemaleRate) / 100',
      'abnormalFemaleRate: Number(formState.abnormalFemaleRate) / 100',
      'fertilizedHatchingRate: Number(formState.fertilizedHatchingRate) / 100',
      'excludedBloodFertilityRate: Number(formState.excludedBloodFertilityRate) / 100',
      '...props.raw',
    ]) expect(modal).toContain(fragment)
    expect(modal).not.toContain('abnormalFemaleRate: [{ required: true')
    for (const fragment of ['typeList: props.typeList', 'authList: props.authList', "http('/config/farm/getFarmByQuery'"]) expect(farm).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("flockSimu/base/standardHatch")',
      '@GetMapping("{id}")',
      '@GetMapping("page")',
      '@PostMapping("save")',
      '@DeleteMapping("{id}")',
      'PageParam.responsePage(resultList)',
      'standardHatchService.multiplyNumHandle(standard, 100)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['Integer year', 'String ageStage', 'String gen', 'String hall', 'String variety', 'Integer genDown', 'Double healthyFemaleRate', 'Double abnormalFemaleRate', 'Double eggChickRatio', 'Double chickWeight', 'Double fertilizedHatchingRate', 'Double excludedBloodFertilityRate', 'Double satisfaction']) expect(entity).toContain(field)
    for (const fragment of ['updateByPrimaryKeySelective(standardHatch)', 'insertSelective(standardHatch)', 'setDelFlag(1)', 'multiplyNumHandle']) expect(service).toContain(fragment)
    for (const fragment of ['del_flag = 0', 'AND age_stage=#{ageStage}', 'AND gen=#{gen}', 'AND hall=#{hall}', 'AND variety=#{variety}', 'AND gen_down=#{genDown}', 'AND `year`=#{year}']) expect(mapper).toContain(fragment)
    for (const fragment of ['@GetMapping(value = "/list")', 'putData("list", list)', 'standardAgeStageService.findList(new StandardAgeStage())']) expect(standardAgeStageController).toContain(fragment)
  })

  it('列表按Portal默认筛选和分页发送，默认genDown为0并保留服务端响应值', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ ageStage: 'age-1', hall: 101, gen: 'G1', variety: 'V1', year: 2026, genDown: 1, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{
      url: '/base/standardHatch/page',
      method: 'get',
      params: { order: '', orderField: '', ageStage: 'age-1', hall: 101, gen: 'G1', variety: 'V1', year: '2026', genDown: 1, pageNo: 2, pageSize: 50 },
    }])
    const defaults = fixture([{ page: { list: [], total: 0 } }])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', ageStage: '', hall: '', gen: '', variety: '', year: '', genDown: 0, pageNo: 1, pageSize: 20 })
  })

  it('日龄段选项请求复刻Portal返回数组', async () => {
    const f = fixture([{ list: [{ id: 'age-1', stage: '1-7日龄' }] }])
    await expect(f.api.ageStageOptions()).resolves.toEqual([{ id: 'age-1', stage: '1-7日龄' }])
    expect(f.calls).toEqual([{ url: '/egg/standardAgeStage/list', method: 'get' }])
  })

  it('新建和编辑按Portal规则转换四个率，保留raw，删除使用路径参数', async () => {
    const f = fixture([{}, {}])
    const prepared = f.api.prepareCreate(form)
    expect(prepared.draft).toMatchObject({ year: 2026, ageStage: 'age-1', hall: 101, genDown: 1, healthyFemaleRate: 0.82, abnormalFemaleRate: 0.6, eggChickRatio: 1.25, chickWeight: 42, fertilizedHatchingRate: 0.9, excludedBloodFertilityRate: 0.88, satisfaction: 95 })
    await expect(f.api.create(prepared)).resolves.toBe(true)
    const update = f.api.prepareUpdate({ ...row, ...form, id: row.id })
    expect(update.draft).toMatchObject({ id: row.id, healthyFemaleRate: 0.82, abnormalFemaleRate: 0.6, fertilizedHatchingRate: 0.9, excludedBloodFertilityRate: 0.88, rawExtension: 'preserved-on-update' })
    await expect(f.api.update(update)).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/base/standardHatch/save', method: 'post', data: prepared.draft },
      { url: '/base/standardHatch/save', method: 'post', data: update.draft },
      { url: `/base/standardHatch/${row.id}`, method: 'delete' },
    ])
    const optional = f.api.prepareCreate({ ...form, abnormalFemaleRate: '' })
    expect(optional.draft.abnormalFemaleRate).toBeNull()
  })

  it('页面required差异、数值边界、分页、ID和坏响应不会静默降级或发请求', async () => {
    const f = fixture([])
    for (const field of ['year', 'ageStage', 'gen', 'hall', 'variety', 'genDown', 'healthyFemaleRate', 'eggChickRatio', 'chickWeight', 'fertilizedHatchingRate', 'excludedBloodFertilityRate', 'satisfaction'] as const) expect(() => f.api.prepareCreate({ ...form, [field]: '' })).toThrow()
    expect(() => f.api.prepareCreate({ ...form, year: 1969 })).toThrow('年度')
    expect(() => f.api.prepareCreate({ ...form, healthyFemaleRate: 10_000_001 })).toThrow('健母率标准')
    expect(() => f.api.prepareCreate({ ...form, genDown: 2 as never })).toThrow('是否降代')
    expect(() => f.api.prepareUpdate({ ...form, id: '' })).toThrow('ID')
    await expect(f.api.list({ genDown: 2 })).rejects.toThrow('是否降代')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])
    await expect(fixture([{ page: { list: [{ ...row, genDown: 2 }], total: 1 } }]).api.list()).rejects.toThrow('.genDown')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ id: '', stage: '坏' }] }]).api.ageStageOptions()).rejects.toThrow('日龄段选项[0].id')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例追加devicetype，当前页面不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ id: row.id })] })
    await expect(captured.api.ageStageOptions()).resolves.toEqual([{ id: 'age-1', stage: '1-7日龄' }])
    expect(captured.calls[0]?.url).toBe('/base/standardHatch/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
    expect(captured.calls[1]?.url).toBe('/egg/standardAgeStage/list')
    expect(captured.calls[1]?.headers?.get('devicetype')).toBe('PC')
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(productSettingStandardHatchCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_STANDARD_HATCH_METHODS))
    expect(productSettingStandardHatchCapabilities.every(item => item.pagePath === PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH && item.permission === PRODUCT_SETTING_STANDARD_HATCH_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_STANDARD_HATCH_MODULE_TYPE)).toBe(true)
    expect(AI_CONTRACTS['product-setting-standard-hatch-list']).toBe(contracts['product-setting-standard-hatch-list'])
    expect(AI_CONTRACTS['product-setting-standard-hatch-age-stage-options']).toBe(contracts['product-setting-standard-hatch-age-stage-options'])
    expect(METHOD_CONTRACTS['productSettingStandardHatch.list']).toBe(methodContracts['productSettingStandardHatch.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-hatch-age-stage-options' && item.sdkPath === 'productSettingStandardHatch.ageStageOptions')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-hatch-prepare-create' && item.sdkPath === 'productSettingStandardHatch.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-hatch-prepare-remove' && item.sdkPath === 'productSettingStandardHatch.prepareRemove')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-standard-hatch-remove' && item.sdkPath === 'productSettingStandardHatch.remove')).toBe(true)
    expect(contracts['product-setting-standard-hatch-create']?.steps[0]?.capabilityId).toBe('product-setting-standard-hatch-list')
    expect(contracts['product-setting-standard-hatch-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_STANDARD_HATCH_SUBMIT_PERMISSION)
  })
})
