import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingEggStandardAgeStageCapability,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHODS,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_MODULE_TYPE,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PERMISSION,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_QUERY_PERMISSION,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_SUBMIT_PERMISSION,
  productSettingEggStandardAgeStageCapabilities,
  type ProductSettingEggStandardAgeStageCreateForm,
} from '../src/capabilities/product-setting-egg-standard-age-stage.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-egg-standard-age-stage.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingEggStandardAgeStageCreateForm = { moulting: 1, stage: '1-7日龄', begin: 1, end: 7 }
const row = { id: 'age-stage-1', moulting: 1, stage: '1-7日龄', begin: 1, end: 7, updateByName: '测试用户', updateDate: '2026-09-24 12:00:00', rawExtension: 'keep' }

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingEggStandardAgeStageCapability(request), calls }
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
  const api = createProductSettingEggStandardAgeStageCapability(config => call(PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH, { ...config, httpInstance: 'product' }))
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 标准库管理 → 孵化日龄段标准页面能力', () => {
  it('逐页锁定菜单、权限、列表/弹窗和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/egg-standard-age-stage/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/egg-standard-age-stage/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/hatch/StandardAgeStageController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/standard/StandardAgeStage.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/hatch/impl/StandardAgeStageServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/standard/StandardAgeStageMapperExt.xml')
    expect(menu).toContain(`path: '${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_SUBMIT_PERMISSION}'`,
      "http.get('/egg/standardAgeStage/page'",
      "http.post('/egg/standardAgeStage/save'",
      "http.delete(`/egg/standardAgeStage/${record.id}`)",
      'v-if="permissionCheck(permissions.submit)"',
      'moulting: 0',
      '@change="rrList.formSubmit"',
    ]) expect(list).toContain(fragment)
    for (const fragment of ["moulting: [{ required: true", "stage: [{ required: true", 'begin: [', 'end: [', 'checkNegative', 'begin: Number(formState.begin)', '...props.raw']) expect(modal).toContain(fragment)
    for (const fragment of ['@RequestMapping(value = "flockSimu/egg/standardAgeStage")', '@GetMapping("page")', '@PostMapping("save")', '@DeleteMapping("{id}")', 'PageParam.responsePage(list)']) expect(controller).toContain(fragment)
    for (const fragment of ['setStage(String stage)', 'this.stage = stage == null ? null : stage.trim()', 'updateByName']) expect(entity).toContain(fragment)
    for (const fragment of ['HRUserUtils.get', 'setUpdateByName', 'updateByPrimaryKeySelective', 'setDelFlag(1)']) expect(service).toContain(fragment)
    for (const fragment of ['AND moulting =#{moulting}', "AND stage like concat(#{stage}, '%')", 'ORDER BY moulting, `begin`', 'del_flag = 0']) expect(mapper).toContain(fragment)
  })

  it('列表按Portal默认值和分页发送，返回updateByName等字段', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ moulting: 1, stage: '1-', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{ url: '/egg/standardAgeStage/page', method: 'get', params: { order: '', orderField: '', moulting: 1, stage: '1-', pageNo: 2, pageSize: 50 } }])
    const defaults = fixture([{ page: { list: [], total: 0 } }])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', moulting: 0, stage: '', pageNo: 1, pageSize: 20 })
  })

  it('新建、编辑和删除逐字段复刻Portal提交体与确认顺序', async () => {
    const f = fixture([{}, {}])
    const prepared = f.api.prepareCreate(form)
    expect(prepared).toEqual({ draft: form })
    await expect(f.api.create(prepared)).resolves.toBe(true)
    const update = f.api.prepareUpdate({ ...row, ...form, id: row.id, stage: '8-14日龄' })
    expect(update.draft).toMatchObject({ id: row.id, stage: '8-14日龄', rawExtension: 'keep' })
    await expect(f.api.update(update)).resolves.toBe(true)
    const remove = f.api.prepareRemove({ id: row.id })
    await expect(f.api.remove(remove)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/egg/standardAgeStage/save', method: 'post', data: prepared.draft },
      { url: '/egg/standardAgeStage/save', method: 'post', data: update.draft },
      { url: `/egg/standardAgeStage/${row.id}`, method: 'delete' },
    ])
  })

  it('必填、非负范围、分页和坏响应失败且不发请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, stage: ' ' })).toThrow('日龄段')
    expect(() => f.api.prepareCreate({ ...form, moulting: 2 as never })).toThrow('是否换羽')
    expect(() => f.api.prepareCreate({ ...form, begin: -1 })).toThrow('起始日龄')
    expect(() => f.api.prepareCreate({ ...form, end: 10_000_001 })).toThrow('终止日龄')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])
    await expect(fixture([{ page: { list: [{ ...row, moulting: 2 }], total: 1 } }]).api.list()).rejects.toThrow('是否换羽')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例追加devicetype，当前页面不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toMatchObject({ list: [expect.objectContaining({ id: row.id })], total: 1 })
    expect(captured.calls[0]?.url).toBe('/egg/standardAgeStage/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(productSettingEggStandardAgeStageCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHODS))
    expect(productSettingEggStandardAgeStageCapabilities.every(item => item.pagePath === PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH && item.permission === PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_MODULE_TYPE)).toBe(true)
    expect(AI_CONTRACTS['product-setting-egg-standard-age-stage-list']).toBe(contracts['product-setting-egg-standard-age-stage-list'])
    expect(METHOD_CONTRACTS['productSettingEggStandardAgeStage.list']).toBe(methodContracts['productSettingEggStandardAgeStage.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-egg-standard-age-stage-prepare-create' && item.sdkPath === 'productSettingEggStandardAgeStage.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-egg-standard-age-stage-prepare-remove' && item.sdkPath === 'productSettingEggStandardAgeStage.prepareRemove')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-egg-standard-age-stage-remove' && item.sdkPath === 'productSettingEggStandardAgeStage.remove')).toBe(true)
    expect(contracts['product-setting-egg-standard-age-stage-create']?.steps[0]?.capabilityId).toBe('product-setting-egg-standard-age-stage-list')
    expect(contracts['product-setting-egg-standard-age-stage-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_SUBMIT_PERMISSION)
  })
})
