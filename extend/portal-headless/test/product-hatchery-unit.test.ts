import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductHatcheryUnitCapability,
  PRODUCT_HATCHERY_UNIT_DELETE_PERMISSION,
  PRODUCT_HATCHERY_UNIT_METHODS,
  PRODUCT_HATCHERY_UNIT_MODULE_TYPE,
  PRODUCT_HATCHERY_UNIT_PAGE_PATH,
  PRODUCT_HATCHERY_UNIT_PERMISSION,
  PRODUCT_HATCHERY_UNIT_QUERY_PERMISSION,
  PRODUCT_HATCHERY_UNIT_SUBMIT_PERMISSION,
  productHatcheryUnitCapabilities,
} from '../src/capabilities/product-hatchery-unit.js'
import { PRODUCT_HATCHERY_UNIT_AI_CONTRACTS as contracts, PRODUCT_HATCHERY_UNIT_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-hatchery-unit.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: 'hatch-unit-1', classification: 22, traitTypeName: '孵化指标', name: '受精率', unit: '%', code: 'HATCH-FERTILITY',
  contentType: 3 as const, contentTypeName: '数值', scale: 2, extension: { source: 'portal' },
}
const createForm = { classification: 22, contentType: 3 as const, name: '受精率', code: 'HATCH-FERTILITY', unit: '%', scale: 2 }
const textForm = { classification: '7', contentType: 1 as const, name: '孵化说明', code: 'HATCH-TEXT-001' }
const updateForm = { ...row, classification: 23, name: '受精率（新）', code: 'HATCH-FERTILITY-2', unit: '%', scale: 3 }

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductHatcheryUnitCapability(request), calls }
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
  const api = createProductHatcheryUnitCapability(
    config => call(PRODUCT_HATCHERY_UNIT_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 孵化预案 → 标准设置页面能力', () => {
  it('逐页锁定孵化包装路由、独立权限与复用组件', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/unit.vue')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/unit/list.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/unit/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/unit/modal-form-content.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const productHttp = read(portalRoot, 'app/portal/utils/http/product.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/ProgramUnitLayController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/program/ProgramUnit.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/ProgramUnitMapper.xml')

    expect(menu).toContain(`path: '${PRODUCT_HATCHERY_UNIT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_HATCHERY_UNIT_PERMISSION}'`)
    expect(route).toContain('title: 标准设置')
    expect(route).toContain(PRODUCT_HATCHERY_UNIT_PERMISSION)
    expect(wrapper).toContain("import HatchManageUnitList from 'app/portal/views/dashboard/product/setting/hatch-manage/unit/list.vue'")
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "query: 'program:unit:query'",
      "submit: 'program:unit:submit'",
      "delete: 'program:unit:delete'",
      "http.get('/programUnit/getList'",
      "http.post('/programUnit/add'",
      "http.post('/programUnit/update'",
      "http.get('/programUnit/delete'",
      'classification: \'\'',
      'search: \'\'',
      'scope: 1',
      'getDataListIsPage: true',
      "idKey: 'id'",
      'type="standard_class"',
      'permissionCheck(permissions.submit)',
      'permissionCheck(permissions.delete)',
      'contentTypeMap',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'contentTypeOptions = [',
      "{ label: '纯文本', value: 1 }",
      "{ label: '富文本', value: 2 }",
      "{ label: '数值', value: 3 }",
      'classification: [{ required: true',
      'contentType: [{ required: true',
      'function validateUnit',
      'function validateScale',
      'if (formState.contentType !== 3)',
      'unit: formState.contentType === 3 ? formState.unit : \'\'',
      'scale: formState.contentType === 3 ? formState.scale : \'\'',
      '...props.raw',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of ['order: orderType.value', 'orderField: orderField.value', 'if (getDataListIsPage)', 'params[fieldNamePageNo] = pageNo.value', 'params[fieldNamePageSize] = pageSize.value']) expect(renrenList).toContain(fragment)
    for (const fragment of ["const keys = Object.keys(data)", 'return keys.length === 1 ? data[keys[0]] : data', "devicetype: 'PC'"]) expect(productHttp).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/programUnit")',
      '@GetMapping(value = "/getList")',
      '@PostMapping(value = "/add")',
      '@PostMapping(value = "/update")',
      '@GetMapping(value = "/delete")',
      'unit.getContentType() == 3 && unit.getScale() == null',
      'programUnitService.getByCode(unit.getCode())',
      'params.put("delFlag", 0)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['traitTypeName', 'code', 'contentType', 'name', 'classification', 'scale', 'unit']) expect(entity).toContain(`private ${field === 'code' || field === 'traitTypeName' || field === 'name' || field === 'unit' ? 'String' : field === 'contentType' || field === 'classification' || field === 'scale' ? 'Integer' : 'String'} ${field}`)
    for (const fragment of ['AND p.classification = #{params.classification}', 'AND (p.name like concat(#{params.search},\'%\') or p.code like concat(#{params.search},\'%\'))', 'id, code, code_full, content_type, name', 'classification', 'scale', 'unit']) expect(mapper).toContain(fragment)

    expect(productHatcheryUnitCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_HATCHERY_UNIT_METHODS))
    expect(productHatcheryUnitCapabilities.every(item => item.pagePath === PRODUCT_HATCHERY_UNIT_PAGE_PATH && item.permission === PRODUCT_HATCHERY_UNIT_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_HATCHERY_UNIT_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_HATCHERY_UNIT_QUERY_PERMISSION).toBe('program:unit:query')
    expect(PRODUCT_HATCHERY_UNIT_SUBMIT_PERMISSION).toBe('program:unit:submit')
    expect(PRODUCT_HATCHERY_UNIT_DELETE_PERMISSION).toBe('program:unit:delete')
  })

  it('列表按Portal逐字段发送并兼容数组和Java page包络', async () => {
    const f = fixture([[row], { page: { records: [row], total: 1 } }])
    await expect(f.api.list({ classification: 22, search: '受精', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([
      { url: '/programUnit/getList', method: 'get', params: { order: '', orderField: '', classification: 22, search: '受精', scope: 1, pageNo: 2, pageSize: 50 } },
      { url: '/programUnit/getList', method: 'get', params: { order: '', orderField: '', classification: '', search: '', scope: 1, pageNo: 1, pageSize: 20 } },
    ])
  })

  it('新建和编辑严格复刻三种文本类型、条件字段、raw透传和JSON提交', async () => {
    const f = fixture([{}, {}, {}])
    const preparedCreate = f.api.prepareCreate(createForm)
    expect(preparedCreate).toEqual({ draft: { id: undefined, classification: 22, contentType: 3, name: '受精率', code: 'HATCH-FERTILITY', unit: '%', scale: 2 } })
    await expect(f.api.create(preparedCreate)).resolves.toBe(true)

    const preparedText = f.api.prepareCreate(textForm)
    expect(preparedText).toEqual({ draft: { id: undefined, classification: '7', contentType: 1, name: '孵化说明', code: 'HATCH-TEXT-001', unit: '', scale: '' } })
    await expect(f.api.create(preparedText)).resolves.toBe(true)

    const preparedUpdate = f.api.prepareUpdate(updateForm)
    expect(preparedUpdate).toEqual({ draft: updateForm })
    await expect(f.api.update(preparedUpdate)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/programUnit/add', method: 'post', data: { id: undefined, classification: 22, contentType: 3, name: '受精率', code: 'HATCH-FERTILITY', unit: '%', scale: 2 } },
      { url: '/programUnit/add', method: 'post', data: { id: undefined, classification: '7', contentType: 1, name: '孵化说明', code: 'HATCH-TEXT-001', unit: '', scale: '' } },
      { url: '/programUnit/update', method: 'post', data: updateForm },
    ])
  })

  it('删除按Portal确认前准备、确认后GET id执行', async () => {
    const f = fixture([{}])
    expect(f.api.prepareRemove({ id: row.id })).toEqual({ id: row.id })
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/programUnit/delete', method: 'get', params: { id: row.id } }])
  })

  it('坏输入不会发请求，条件字段和响应边界不会静默降级', async () => {
    const empty = fixture([])
    expect(() => empty.api.prepareCreate({ ...createForm, classification: '' })).toThrow('指标归类')
    expect(() => empty.api.prepareCreate({ ...createForm, contentType: 4 as never })).toThrow('文本类型')
    expect(() => empty.api.prepareCreate({ ...createForm, unit: '' })).toThrow('指标单位')
    expect(() => empty.api.prepareCreate({ ...createForm, scale: null })).toThrow('小数位数')
    expect(() => empty.api.prepareUpdate({ ...updateForm, code: '' })).toThrow('指标编码')
    expect(() => empty.api.prepareRemove({ id: '' })).toThrow('ID')
    await expect(empty.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(empty.calls).toEqual([])
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ ...row, contentType: 4 }], total: 1 }]).api.list()).rejects.toThrow('文本类型')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/programUnit/getList')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖公开方法、条件表单、权限、回查步骤并重新绑定孵化路径', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_HATCHERY_UNIT_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_HATCHERY_UNIT_METHODS).map(method => `productHatcheryUnit.${method}`).sort())
    expect(contracts['product-hatchery-unit-prepare-create']?.whenToUse).toContain(PRODUCT_HATCHERY_UNIT_PAGE_PATH)
    expect(contracts['product-hatchery-unit-create']?.boundaries.join('\n')).toContain(PRODUCT_HATCHERY_UNIT_PERMISSION)
    expect(contracts['product-hatchery-unit-create']?.steps.some(step => step.capabilityId === 'product-hatchery-unit-list')).toBe(true)
    expect(contracts['product-hatchery-unit-prepare-create']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['product-hatchery-unit-list']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].contentType', 'list[].unit', 'list[].scale', 'total']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productHatcheryUnitCapabilities, contracts })).toEqual([])
  })
})
