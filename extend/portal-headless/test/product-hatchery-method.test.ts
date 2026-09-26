import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import {
  createProductHatcheryMethodCapability,
  PRODUCT_HATCHERY_METHOD_DELETE_PERMISSION,
  PRODUCT_HATCHERY_METHODS,
  PRODUCT_HATCHERY_METHOD_MODULE_TYPE,
  PRODUCT_HATCHERY_METHOD_PAGE_PATH,
  PRODUCT_HATCHERY_METHOD_PERMISSION,
  PRODUCT_HATCHERY_METHOD_QUERY_PERMISSION,
  PRODUCT_HATCHERY_METHOD_SUBMIT_PERMISSION,
  productHatcheryMethodCapabilities,
} from '../src/capabilities/product-hatchery-method.js'
import { AI_CONTRACTS } from '../src/catalog/ai-contracts.js'
import { PRODUCT_HATCHERY_METHOD_AI_CONTRACTS as contracts, PRODUCT_HATCHERY_METHOD_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-hatchery-method.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: 'hatchery-method-1', classification: 21, traitTypeName: '孵化', name: '翻蛋', traitName: '翻蛋',
  title1: '一级', title2: '二级', title3: '三级', code: 'HM-001', extension: { source: 'portal' },
}
const createForm = { traitType: 21, name: '翻蛋', title1: '一级', title2: '二级', title3: '三级' }
const updateForm = {
  id: 'hatchery-method-1', classification: 21, traitName: '原方法', title1: '新的一级', title2: '新的二级', title3: '新的三级',
  extension: { source: 'row' },
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductHatcheryMethodCapability(request), calls }
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
  const api = createProductHatcheryMethodCapability(
    config => call(PRODUCT_HATCHERY_METHOD_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 孵化预案 → 方法设置页面能力', () => {
  it('逐页锁定孵化菜单权限、包装组件、product接口、表单和Java映射', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/method.vue')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/method/list.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/method/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/method/modal-form-content.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const productHttp = read(portalRoot, 'app/portal/utils/http/product.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/ProgramUnitLayController.java')
    const methodController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/programNew/MethodLibController.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/program/ProgramNewStandardLibTraitDTO.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/ProgramUnitMapper.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/program/impl/ProgramNewServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_HATCHERY_METHOD_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_HATCHERY_METHOD_PERMISSION}'`)
    expect(route).toContain('title: 方法设置')
    expect(route).toContain(PRODUCT_HATCHERY_METHOD_PERMISSION)
    expect(wrapper).toContain("import HatchManageMethodList from 'app/portal/views/dashboard/product/setting/hatch-manage/method/list.vue'")
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "query: 'program:method:query'",
      "submit: 'program:method:submit'",
      "delete: 'program:method:delete'",
      "http.get('/programUnit/getList'",
      "http.post('/programNew/methodLib/createTrait'",
      "http.post('/programNew/methodLib/editTrait'",
      "http.get('/programNew/methodLib/deleteTrait'",
      'classification: \'\'',
      'search: \'\'',
      'scope: 1',
      'getDataListIsPage: true',
      "idKey: 'id'",
      'type="method_class"',
      'permissionCheck(permissions.submit)',
      'permissionCheck(permissions.delete)',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'id: undefined',
      "formState.traitType = props.raw.traitType ? String(props.raw.traitType) : (props.raw.classification ? String(props.raw.classification) : '')",
      "formState.name = props.raw.name || props.raw.traitName || ''",
      'title1: formState.title1',
      'title2: formState.title2',
      'title3: formState.title3',
      'const formRules = {',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of ['order: orderType.value', 'orderField: orderField.value', 'if (getDataListIsPage)', 'params[fieldNamePageNo] = pageNo.value', 'params[fieldNamePageSize] = pageSize.value']) expect(renrenList).toContain(fragment)
    for (const fragment of [
      'const keys = Object.keys(data)',
      'return keys.length === 1 ? data[keys[0]] : data',
      "devicetype: 'PC'",
    ]) expect(productHttp).toContain(fragment)
    for (const fragment of ['@RequestMapping(value = "flockSimu/programUnit")', '@GetMapping(value = "/getList")', 'params.put("delFlag", 0)', 'PageParam.responsePage(list)']) expect(controller).toContain(fragment)
    for (const fragment of ['@RequestMapping(value = "flockSimu/programNew/methodLib")', '@PostMapping(value = "/createTrait")', '@PostMapping(value = "/editTrait")', '@GetMapping(value = "/deleteTrait")', 'dto.getAge() == null']) expect(methodController).toContain(fragment)
    for (const field of ['id', 'traitCode', 'traitName', 'title1', 'title2', 'title3', 'traitType', 'age', 'ageType']) expect(dto).toContain(`private ${field === 'id' || field === 'traitCode' || field === 'traitName' || field.startsWith('title') ? 'String' : 'Integer'} ${field}`)
    for (const fragment of ['AND p.classification = #{params.classification}', 'AND (p.name like concat(#{params.search},\'%\') or p.code like concat(#{params.search},\'%\'))']) expect(mapper).toContain(fragment)
    for (const fragment of ['programLibService.updateValueById', 'programLibService.deleteById(list.get(0).getId())', 'programLibService.deleteById(id)']) expect(service).toContain(fragment)

    expect(productHatcheryMethodCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_HATCHERY_METHODS))
    expect(productHatcheryMethodCapabilities.every(item => item.pagePath === PRODUCT_HATCHERY_METHOD_PAGE_PATH && item.permission === PRODUCT_HATCHERY_METHOD_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_HATCHERY_METHOD_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_HATCHERY_METHOD_QUERY_PERMISSION).toBe('program:method:query')
    expect(PRODUCT_HATCHERY_METHOD_SUBMIT_PERMISSION).toBe('program:method:submit')
    expect(PRODUCT_HATCHERY_METHOD_DELETE_PERMISSION).toBe('program:method:delete')
  })

  it('列表按Portal逐字段发送并兼容Java page包络', async () => {
    const f = fixture([{ page: { records: [row], total: 1 } }])
    await expect(f.api.list({ classification: 21, search: '孵', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([
      { url: '/programUnit/getList', method: 'get', params: { order: '', orderField: '', classification: 21, search: '孵', scope: 1, pageNo: 2, pageSize: 50 } },
    ])
  })

  it('新建和编辑严格复刻弹窗必填、类型转换、raw透传和JSON提交', async () => {
    const f = fixture([{}, {}])
    const preparedCreate = f.api.prepareCreate(createForm)
    expect(preparedCreate).toEqual({ draft: { id: undefined, traitType: '21', name: '翻蛋', title1: '一级', title2: '二级', title3: '三级' } })
    await expect(f.api.create(preparedCreate)).resolves.toBe(true)

    const preparedUpdate = f.api.prepareUpdate(updateForm)
    expect(preparedUpdate).toEqual({ draft: {
      ...updateForm, traitType: '21', name: '原方法',
    } })
    await expect(f.api.update(preparedUpdate)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/programNew/methodLib/createTrait', method: 'post', data: { id: undefined, traitType: '21', name: '翻蛋', title1: '一级', title2: '二级', title3: '三级' } },
      { url: '/programNew/methodLib/editTrait', method: 'post', data: { ...updateForm, traitType: '21', name: '原方法' } },
    ])
  })

  it('删除按Portal确认前准备、确认后GET id执行', async () => {
    const f = fixture([{}])
    expect(f.api.prepareRemove({ id: row.id })).toEqual({ id: row.id })
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/programNew/methodLib/deleteTrait', method: 'get', params: { id: row.id } }])
  })

  it('坏输入不会发请求，响应和分页边界不会静默降级', async () => {
    const empty = fixture([])
    expect(() => empty.api.prepareCreate({ ...createForm, name: '' })).toThrow('名称')
    expect(() => empty.api.prepareCreate({ ...createForm, traitType: '' })).toThrow('方法归类')
    expect(() => empty.api.prepareUpdate({ ...updateForm, traitName: '' })).toThrow('名称')
    expect(() => empty.api.prepareRemove({ id: '' })).toThrow('ID')
    await expect(empty.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(empty.calls).toEqual([])
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ ...row, title2: 3 }], total: 1 }]).api.list()).rejects.toThrow('title2')
  })

  it('product实例补devicetype且孵化页面不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/programUnit/getList')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖公开方法、孵化权限、取消与回查步骤且未混入养殖页面上下文', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_HATCHERY_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_HATCHERY_METHODS).map(method => `productHatcheryMethod.${method}`).sort())
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    const serialized = JSON.stringify(contracts)
    expect(serialized).toContain(PRODUCT_HATCHERY_METHOD_PAGE_PATH)
    expect(serialized).toContain(PRODUCT_HATCHERY_METHOD_PERMISSION)
    expect(serialized).not.toContain('/dashboard/product/setting/hatch-manage/method/list')
    expect(serialized).not.toContain('/dashboard/frame/breeding-plan/method')
    expect(contracts['product-hatchery-method-prepare-create']?.steps.some(item => item.role === 'cancel')).toBe(true)
    expect(contracts['product-hatchery-method-create']?.steps.some(item => item.capabilityId === 'product-hatchery-method-list')).toBe(true)
    expect(contracts['product-hatchery-method-create']?.failures.join('\n')).toContain('协议差异')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productHatcheryMethodCapabilities, contracts })).toEqual([])
  })

  it('通用invoke把准备表单映射到孵化预案方法设置门面', async () => {
    const f = fixture([])
    const binding = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-hatchery-method-prepare-create')
    expect(binding).toBeDefined()
    await expect(binding!.run({ productHatcheryMethod: f.api } as never, { form: createForm })).resolves.toEqual({
      draft: { id: undefined, traitType: '21', name: '翻蛋', title1: '一级', title2: '二级', title3: '三级' },
    })
  })
})
