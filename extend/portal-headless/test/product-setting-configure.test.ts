import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingConfigureCapability,
  PRODUCT_SETTING_CONFIGURE_DELETE_PERMISSION,
  PRODUCT_SETTING_CONFIGURE_EDIT_PERMISSION,
  PRODUCT_SETTING_CONFIGURE_METHODS,
  PRODUCT_SETTING_CONFIGURE_MODULE_TYPE,
  PRODUCT_SETTING_CONFIGURE_PAGE_PATH,
  PRODUCT_SETTING_CONFIGURE_PERMISSION,
  PRODUCT_SETTING_CONFIGURE_QUERY_PERMISSION,
  productSettingConfigureCapabilities,
  type ProductSettingConfigureUpdateDraft,
} from '../src/capabilities/product-setting-configure.js'
import {
  PRODUCT_SETTING_CONFIGURE_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_CONFIGURE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-configure.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: 'trait-1',
  code: 'C001',
  name: '指标A',
  fieldType: 2,
  multipleAttribute: 1,
  decimalPlace: 2,
  unit: 'kg',
  general: 0,
  defaultValue: '0',
  required: 1,
  maxValue: 100,
  minValue: 0,
  dateType: null,
  dicts: null,
  createDate: '2026-09-23T10:00:00',
  updateDate: '2026-09-24T10:00:00',
  remarks: null,
  delFlag: 0,
  type: 1,
}

const form: ProductSettingConfigureUpdateDraft = {
  id: 'trait-1',
  type: 1,
  code: 'C001',
  name: '指标A',
  fieldType: '2',
  multipleAttribute: '1',
  defaultValue: '0',
  minValue: '0',
  maxValue: '100',
  decimalPlace: 2,
  required: '1',
  unit: 'kg',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingConfigureCapability(request), calls }
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
    { baseUrls: { product: 'https://fmtest.zhihuidanji.com/flockSimu' } },
  )
  const api = createProductSettingConfigureCapability(
    config => call(PRODUCT_SETTING_CONFIGURE_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 产品设置 → 配置指标页面能力', () => {
  it('逐页锁定菜单、product实例、权限、列表动作、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/configure/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/configure/modal-form-content.vue')
    const commonList = read(portalRoot, 'common/libs/renren/list.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/config/TraitController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/config/Trait.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/config/TraitDao.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/config/TraitService.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_CONFIGURE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_CONFIGURE_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_CONFIGURE_QUERY_PERMISSION}'`,
      `edit: '${PRODUCT_SETTING_CONFIGURE_EDIT_PERMISSION}'`,
      `delete: '${PRODUCT_SETTING_CONFIGURE_DELETE_PERMISSION}'`,
      "url: '/config/traitIndex'",
      "method: 'GET'",
      'type: 1',
      'Array.isArray(res) ? res : (res?.list || res?.records || res?.rows || [])',
      "keyId: 'id'",
      'getDataListIsPage: false',
      'url: `/config/traitIndex/${record.id}`',
      "method: 'POST'",
      'data: form',
      'permissionCheck(permissions.edit)',
      'permissionCheck(permissions.delete)',
      'rrList.actionDelete(row)',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "fieldType: props.record?.fieldType ? String(props.record.fieldType) : '2'",
      "multipleAttribute: props.record?.multipleAttribute || ''",
      "minValue: props.record?.minValue || '0'",
      "required: props.record?.required || '1'",
      "Number(value) || value === '0' || value === '' || value === 0",
      'code: [',
      "{ required: true, message: '请输入字段编码', trigger: 'blur' }",
      'multipleAttribute: [',
      "{ required: true, message: '请选择属性', trigger: 'change' }",
      'decimalPlace: formState.decimalPlace',
      'type: 1',
      'if (formState.id)',
      'submitData.id = formState.id',
    ]) expect(formSource).toContain(fragment)
    expect(list).not.toContain('deleteURL:')
    expect(list).not.toContain('customDelete:')
    expect(commonList).toContain('const url = deleteIsBatch ? deleteURL : `${deleteURL}/${id}`')
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/config/traitIndex")',
      '@GetMapping(value = "{id}")',
      'putData("traitIndex"',
      '@GetMapping',
      'putData("page", page)',
      '@PostMapping',
      '@RequestBody List<Trait> traitIndexList',
    ]) expect(controller).toContain(fragment)
    expect(controller).not.toContain('@DeleteMapping')
    for (const field of ['code', 'name', 'fieldType', 'multipleAttribute', 'decimalPlace', 'unit', 'general', 'defaultValue', 'required', 'maxValue', 'minValue', 'dateType', 'type', 'dicts']) expect(entity).toContain(field)
    for (const fragment of [
      'a.field_type AS "fieldType"',
      'a.multiple_attribute AS "multipleAttribute"',
      'a.default_value as "defaultValue"',
      'a.required as "required"',
      'a.max_value as "maxValue"',
      'a.min_value as "minValue"',
      'name LIKE CONCAT(#{name}, \'%\')',
      'OR `code` LIKE CONCAT(#{name}, \'%\')',
      '<update id="update">',
      '<update id="delete">',
      'del_flag = \'1\'',
    ]) expect(mapper).toContain(fragment)
    for (const fragment of [
      'public StringBuilder saveTraitList(List<Trait> traitList)',
      'if (t.getIsNewRecord())',
      'dao.insert(t)',
      'dao.update(t)',
    ]) expect(service).toContain(fragment)

    expect(productSettingConfigureCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_CONFIGURE_METHODS))
    expect(productSettingConfigureCapabilities.every(item => item.pagePath === PRODUCT_SETTING_CONFIGURE_PAGE_PATH && item.permission === PRODUCT_SETTING_CONFIGURE_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_CONFIGURE_MODULE_TYPE)).toBe(true)
  })

  it('列表、详情和编辑提交按Portal逐字段发送，且不凭空添加分页或删除请求', async () => {
    const f = fixture([{ list: [row], total: 1 }, row, {}])
    await expect(f.api.list({ name: '指标' })).resolves.toEqual([row])
    await expect(f.api.get({ id: row.id })).resolves.toEqual(row)
    expect(f.api.prepareUpdate(form)).toEqual({ draft: form })
    await expect(f.api.update({ draft: form })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/config/traitIndex', method: 'get', params: { order: '', orderField: '', name: '指标', type: 1 } },
      { url: '/config/traitIndex/trait-1', method: 'get' },
      { url: '/config/traitIndex', method: 'post', data: form },
    ])
  })

  it('逐字段复刻表单默认值、必填和数字校验，非法值在请求前失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ name: 1 as never })).rejects.toThrow('指标名')
    await expect(f.api.get({ id: '' })).rejects.toThrow('ID')
    expect(() => f.api.prepareUpdate({ ...form, id: '' as never })).toThrow('ID')
    expect(() => f.api.prepareUpdate({ ...form, code: ' ' })).toThrow('字段编码')
    expect(() => f.api.prepareUpdate({ ...form, name: '' })).toThrow('字段名称')
    expect(() => f.api.prepareUpdate({ ...form, fieldType: '' })).toThrow('字段类型')
    expect(() => f.api.prepareUpdate({ ...form, multipleAttribute: '' })).toThrow('字段属性')
    expect(() => f.api.prepareUpdate({ ...form, minValue: 'bad' })).toThrow('最小数值')
    expect(() => f.api.prepareUpdate({ ...form, maxValue: ' ' })).toThrow('最大数值')
    expect(() => f.api.prepareUpdate({ ...form, decimalPlace: -1 })).toThrow('小数位数')
    expect(() => f.api.prepareUpdate({ ...form, decimalPlace: 1.5 })).toThrow('小数位数')
    expect(f.api.prepareUpdate({ ...form, minValue: '', maxValue: '' })).toEqual({ draft: { ...form, minValue: '', maxValue: '' } })
    expect(f.calls).toEqual([])

    await expect(fixture([{ list: [{ ...row, fieldType: '2' }] }]).api.list()).rejects.toThrow('fieldType')
    await expect(fixture([{ rows: [] }]).api.list()).resolves.toEqual([])
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
    await expect(fixture([{}]).api.list()).rejects.toThrow('配置指标列表响应缺少数组')
  })

  it('product实例补请求头且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list({ name: '指标' })).resolves.toEqual([row])
    expect(captured.calls[0]?.url).toBe('/config/traitIndex')
    expect(captured.calls[0]?.params).toEqual({ order: '', orderField: '', name: '指标', type: 1, _t: expect.any(Number) })
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖所有方法、表单规则、权限、删除边界和写入回查', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_CONFIGURE_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_CONFIGURE_METHODS).map(method => `productSettingConfigure.${method}`).sort())
    expect(contracts['product-setting-configure-update']?.effect).toBe('write')
    expect(contracts['product-setting-configure-update']?.steps[0]?.capabilityId).toBe('product-setting-configure-prepare-update')
    expect(contracts['product-setting-configure-prepare-update']?.steps[0]?.capabilityId).toBe('product-setting-configure-update')
    expect(contracts['product-setting-configure-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_CONFIGURE_QUERY_PERMISSION)
    expect(contracts['product-setting-configure-update']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_CONFIGURE_EDIT_PERMISSION)
    expect(contracts['product-setting-configure-update']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_CONFIGURE_DELETE_PERMISSION)
    expect(contracts['product-setting-configure-update']?.boundaries.join('\n')).toContain('不是数组')
    expect(contracts['product-setting-configure-prepare-update']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['draft.id', 'draft.code', 'draft.fieldType', 'draft.minValue', 'draft.maxValue']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingConfigureCapabilities, contracts })).toEqual([])
  })
})
