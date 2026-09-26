import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingHatchManageVarietyCapability,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_SUBMIT_PERMISSION,
  productSettingHatchManageVarietyCapabilities,
} from '../src/capabilities/product-setting-hatch-manage-variety.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import { PRODUCT_SETTING_HATCH_MANAGE_VARIETY_AI_CONTRACTS as contracts, PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-setting-hatch-manage-variety.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: 'variety-1', name: 'LAYER', code: 'LAYER-001', caption: '蛋鸡', icon: 'https://example.test/layer.png',
  variety: 'variety-code', varietyName: '海兰', gen: 'gen-code', genName: '祖代', extension: { source: 'portal' },
}
const createForm = { name: 'LAYER', code: 'LAYER-001', caption: '蛋鸡', icon: 'icon', variety: 'variety-code', gen: 'gen-code' }
const updateForm = { ...row, name: 'LAYER-UPDATED', code: 'LAYER-002', caption: '更新说明', extra: 'drop' }

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingHatchManageVarietyCapability(request), calls }
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
    { baseUrls: { product: 'https://biz-api-test.wodecorp.cn/flockSimu' } },
  )
  const api = createProductSettingHatchManageVarietyCapability(
    config => call(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 养殖预案 → 预案品种页面能力', () => {
  it('逐页锁定菜单、路由、权限、分支接口、表单、公共分页和Java映射', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/variety.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/variety/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/variety/modal-form-content.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const productHttp = read(portalRoot, 'app/portal/utils/http/product.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/sys/ParameterController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/sys/Parameter.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/sys/ParameterDTO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/sys/impl/ParameterServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/sys/ParameterMapper.xml')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION}'`)
    expect(route).toContain('title: 预案品种')
    expect(route).toContain(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "query: 'program:variety:query'",
      "submit: 'program:variety:submit'",
      "delete: 'program:variety:delete'",
      "http.get('/sys/parameter/page'",
      "http.post('/sys/parameter/save'",
      "http.get('/sys/parameter/delete'",
      'const suiteId = route.query?.suiteId || \'\'',
      'getDataListIsPage: true',
      "idKey: 'id'",
      'permissionCheck(permissions.submit)',
      'permissionCheck(permissions.delete)',
      '...payload',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'id: props.raw?.id || \'\'',
      'name: props.raw?.name || \'\'',
      'code: props.raw?.code || \'\'',
      'caption: props.raw?.caption || \'\'',
      'icon: props.raw?.icon || \'\'',
      'variety: props.raw?.variety || \'\'',
      'gen: props.raw?.gen || \'\'',
      "name: [{ required: true",
      "code: [{ required: true",
      "caption: [{ required: true",
      '...formState.value',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of ['order: orderType.value', 'orderField: orderField.value', 'params[fieldNamePageNo] = pageNo.value', 'params[fieldNamePageSize] = pageSize.value']) expect(renrenList).toContain(fragment)
    for (const fragment of ["const keys = Object.keys(data)", 'return keys.length === 1 ? data[keys[0]] : data', "devicetype: 'PC'"]) expect(productHttp).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/sys/parameter")',
      '@GetMapping(value = "/page")',
      '@PostMapping(value = "/save")',
      '@GetMapping(value = "/delete")',
      'parameterService.selectByPage(params)',
      'parameterService.deleteList(List.of(id))',
    ]) expect(controller).toContain(fragment)
    for (const field of ['name', 'caption', 'code', 'icon', 'gen', 'variety']) expect(entity).toContain(`private String ${field}`)
    for (const field of ['genName', 'varietyName']) expect(dto).toContain(`private String ${field}`)
    for (const fragment of ['e.setGenName', 'e.setVarietyName', 'StringUtils.isBlank(parameter.getId())', 'parameterMapper.insertSelective(parameter)', 'parameterMapper.updateByPrimaryKeySelective(parameter)']) expect(service).toContain(fragment)
    for (const fragment of ['from fm_sys_parameter', 'parameter.del_flag = 0', 'update fm_sys_parameter set del_flag = 1']) expect(mapper).toContain(fragment)

    expect(productSettingHatchManageVarietyCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS))
    expect(productSettingHatchManageVarietyCapabilities.every(item => item.pagePath === PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH && item.permission === PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_HATCH_MANAGE_VARIETY_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_QUERY_PERMISSION).toBe('program:variety:query')
    expect(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_SUBMIT_PERMISSION).toBe('program:variety:submit')
    expect(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_DELETE_PERMISSION).toBe('program:variety:delete')
  })

  it('列表按Portal customLoad逐字段发送suiteId和公共分页，并兼容Java page包络', async () => {
    const f = fixture([{ data: { records: [row], total: 1 } }, { list: [row], total: 1 }])
    await expect(f.api.list({ suiteId: 'suite-1', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([
      { url: '/sys/parameter/page', method: 'get', params: { order: '', orderField: '', pageNo: 2, pageSize: 50, suiteId: 'suite-1' } },
      { url: '/sys/parameter/page', method: 'get', params: { order: '', orderField: '', pageNo: 1, pageSize: 20 } },
    ])
  })

  it('新建和编辑严格复刻七个表单字段、空值默认和suiteId请求体', async () => {
    const f = fixture([{}, {}])
    const preparedCreate = f.api.prepareCreate(createForm)
    expect(preparedCreate).toEqual({ draft: { id: '', name: 'LAYER', code: 'LAYER-001', caption: '蛋鸡', icon: 'icon', variety: 'variety-code', gen: 'gen-code' } })
    await expect(f.api.create(preparedCreate)).resolves.toBe(true)

    const preparedUpdate = f.api.prepareUpdate(updateForm)
    expect(preparedUpdate).toEqual({ draft: { id: 'variety-1', name: 'LAYER-UPDATED', code: 'LAYER-002', caption: '更新说明', icon: 'https://example.test/layer.png', variety: 'variety-code', gen: 'gen-code' } })
    await expect(f.api.update({ draft: preparedUpdate.draft, suiteId: 'suite-7' })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/sys/parameter/save', method: 'post', data: { id: '', name: 'LAYER', code: 'LAYER-001', caption: '蛋鸡', icon: 'icon', variety: 'variety-code', gen: 'gen-code' } },
      { url: '/sys/parameter/save', method: 'post', data: { id: 'variety-1', name: 'LAYER-UPDATED', code: 'LAYER-002', caption: '更新说明', icon: 'https://example.test/layer.png', variety: 'variety-code', gen: 'gen-code', suiteId: 'suite-7' } },
    ])
  })

  it('删除按Portal确认前准备、确认后GET id执行', async () => {
    const f = fixture([{}])
    expect(f.api.prepareRemove({ id: row.id })).toEqual({ id: row.id })
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/sys/parameter/delete', method: 'get', params: { id: row.id } }])
  })

  it('坏输入不会发请求，缺少必填字段和响应边界不会静默降级', async () => {
    const empty = fixture([])
    expect(() => empty.api.prepareCreate({ ...createForm, name: '' })).toThrow('名字')
    expect(() => empty.api.prepareCreate({ ...createForm, code: '' })).toThrow('编码')
    expect(() => empty.api.prepareCreate({ ...createForm, caption: '' })).toThrow('说明')
    expect(() => empty.api.prepareUpdate({ ...updateForm, id: '' })).not.toThrow()
    expect(() => empty.api.prepareRemove({ id: '' })).toThrow('ID')
    await expect(empty.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(empty.api.list({ suiteId: 7 as never })).rejects.toThrow('suiteId')
    expect(empty.calls).toEqual([])
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ ...row, genName: 3 }], total: 1 }]).api.list()).rejects.toThrow('genName')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/sys/parameter/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖公开方法、suiteId边界、表单、权限和回查步骤，并已注册', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS).map(method => `productSettingHatchManageVariety.${method}`).sort())
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['product-setting-hatch-manage-variety-create']?.boundaries.join('\n')).toContain('suiteId')
    expect(contracts['product-setting-hatch-manage-variety-update']?.output.fields.map(item => item.path)).not.toContain('draft.extension')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingHatchManageVarietyCapabilities, contracts })).toEqual([])
  })

  it('通用invoke按参数名适配准备表单，不改变公开方法的直接调用形状', async () => {
    const f = fixture([])
    const binding = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-hatch-manage-variety-prepare-create')
    expect(binding).toBeDefined()
    const result = await binding!.run({ productSettingHatchManageVariety: f.api } as never, { form: createForm })
    expect(result).toEqual({ draft: { id: '', name: 'LAYER', code: 'LAYER-001', caption: '蛋鸡', icon: 'icon', variety: 'variety-code', gen: 'gen-code' } })
  })
})
