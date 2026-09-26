import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingUserDictCapability,
  PRODUCT_SETTING_USER_DICT_METHODS,
  PRODUCT_SETTING_USER_DICT_MODULE_TYPE,
  PRODUCT_SETTING_USER_DICT_PAGE_PATH,
  PRODUCT_SETTING_USER_DICT_PERMISSION,
  PRODUCT_SETTING_USER_DICT_QUERY_PERMISSION,
  PRODUCT_SETTING_USER_DICT_SUBMIT_PERMISSION,
  productSettingUserDictCapabilities,
} from '../src/capabilities/product-setting-user-dict.js'
import {
  PRODUCT_SETTING_USER_DICT_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_USER_DICT_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-user-dict.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: 'dict-1',
  value: 'breed-1',
  label: '京红1号',
  description: '品种',
  type: 'variety',
  status: 1 as 0 | 1,
  statusStr: '已启用',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingUserDictCapability(request), calls }
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
  const api = createProductSettingUserDictCapability(
    config => call(PRODUCT_SETTING_USER_DICT_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 产品设置 → 鸡群范围页面能力', () => {
  it('逐页锁定菜单、product实例、页面权限、弹窗保存源码和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/base-setting/user-dict/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/base-setting/user-dict/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/sys/DictController.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/sys/vo/DictVO.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/hr/HRDict.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/hr/HRDictMapper.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/hr/impl/HRDictServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_USER_DICT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_USER_DICT_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_USER_DICT_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_USER_DICT_SUBMIT_PERMISSION}'`,
      "http.get('/sys/dict/userDictTypeList')",
      "http.get('/sys/dict/userDictPage'",
      "record.status === 1 ? '/sys/dict/deactivate' : '/sys/dict/enable'",
      'record.id || record.dictId || record.dictID',
      'permissionCheck(permissions.submit)',
    ]) expect(list).toContain(fragment)
    expect(list).toContain('function handleCreate ()')
    expect(list).toContain('function handleEdit (record)')
    expect((list.match(/modal\.on\('submit'/g) ?? [])).toHaveLength(2)
    expect(list).toContain("http.post('/sys/dict/userDictSave', payload)")

    for (const fragment of [
      "type: [{ required: true, message: '必填', trigger: 'change' }]",
      "label: [{ required: true, message: '必填', trigger: 'blur' }]",
      "value: [{ required: true, message: '必填', trigger: 'blur' }]",
      'id: formState.id',
      'description: formState.description',
      'label: formState.label',
      'value: formState.value',
      'modalCancel',
    ]) expect(formSource).toContain(fragment)

    for (const fragment of [
      '@RequestMapping(value = "flockSimu/sys/dict")',
      '@GetMapping("userDictPage")',
      '@GetMapping("userDictTypeList")',
      '@GetMapping("enable")',
      '@GetMapping(value = "deactivate")',
      'putData("page", page)',
      'putData("typeList", typeList)',
      'hrDictService.updateStatus(1, dictId',
      'hrDictService.updateStatus(0, dictId',
    ]) expect(controller).toContain(fragment)
    expect(controller).not.toContain('userDictSave')
    for (const field of ['type', 'tenantId']) expect(vo).toContain(`private ${field === 'tenantId' ? 'Long' : 'String'} ${field};`)
    for (const field of ['id', 'value', 'label', 'type', 'description', 'status']) expect(entity).toContain(`private ${field === 'status' ? 'Integer' : field === 'id' ? 'String' : 'String'} ${field};`)
    for (const fragment of ['<select id="getUserDictList"', 'selectUserDictTypeList', '<update id="updateStatus"', 'sud.tenant_id = #{tenantId}', 'sud.status = #{status}']) expect(mapper).toContain(fragment)
    for (const fragment of ['userDictPageWithPageHelper', 'getUserDictTypeList', 'checkDictIsUse', 'updateStatus']) expect(service).toContain(fragment)

    expect(productSettingUserDictCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_USER_DICT_METHODS))
    expect(productSettingUserDictCapabilities.every(item => item.pagePath === PRODUCT_SETTING_USER_DICT_PAGE_PATH && item.permission === PRODUCT_SETTING_USER_DICT_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_USER_DICT_MODULE_TYPE)).toBe(true)
    expect(Object.keys(PRODUCT_SETTING_USER_DICT_METHODS)).toEqual([
      'product-setting-user-dict-list',
      'product-setting-user-dict-type-list',
      'product-setting-user-dict-enable',
      'product-setting-user-dict-deactivate',
      'product-setting-user-dict-prepare-save',
      'product-setting-user-dict-save',
      'product-setting-user-dict-cancel-save',
    ])
  })

  it('类型候选、列表请求和分页包络逐字段复刻Portal', async () => {
    const f = fixture([
      { typeList: [{ type: 'variety', description: '品种' }] },
      { page: { list: [row], total: 1 } },
    ])
    await expect(f.api.typeList()).resolves.toEqual([{ value: 'variety', label: '品种' }])
    await expect(f.api.list({ type: 'variety', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([
      { url: '/sys/dict/userDictTypeList', method: 'get' },
      { url: '/sys/dict/userDictPage', method: 'get', params: { order: '', orderField: '', type: 'variety', pageNo: 2, pageSize: 50 } },
    ])
  })

  it('启用和停用严格按Portal端点发送dictId', async () => {
    const f = fixture([{}, {}])
    await expect(f.api.enable({ dictId: row.id })).resolves.toBe(true)
    await expect(f.api.deactivate({ dictId: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/sys/dict/enable', method: 'get', params: { dictId: 'dict-1' } },
      { url: '/sys/dict/deactivate', method: 'get', params: { dictId: 'dict-1' } },
    ])
  })

  it('弹窗保存按prepare→submit→cancel复刻五字段body，新建保留空id', async () => {
    const f = fixture([{}])
    const input = {
      id: '',
      type: 'variety',
      description: '品种',
      label: '京红1号',
      value: 'JH1',
    }
    const prepared = f.api.prepareUserDictSave(input)
    expect(prepared).toEqual({ draft: input })
    expect(f.api.cancelUserDictSave()).toEqual({ cancelled: true })
    expect(f.calls).toHaveLength(0)

    await expect(f.api.submitUserDictSave(prepared)).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/sys/dict/userDictSave', method: 'post', data: input }])
  })

  it('分页、ID、状态和坏响应在发请求前或响应处失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.enable({ dictId: '' })).rejects.toThrow('ID')
    await expect(f.api.deactivate({ dictId: null as never })).rejects.toThrow('ID')
    expect(() => f.api.prepareUserDictSave({
      id: '',
      type: 'variety',
      description: '',
      label: '',
      value: 'JH1',
    })).toThrow(/label/)
    expect(f.calls).toEqual([])

    await expect(fixture([{ typeList: null }]).api.typeList()).rejects.toThrow('typeList')
    await expect(fixture([{ page: { list: [{ ...row, status: '启用' }], total: 1 } }]).api.list()).rejects.toThrow('status')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例补请求头且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/sys/dict/userDictPage')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约已注册项保持可验证；新增共享接线由主线补齐', async () => {
    const registeredIds = Object.keys(contracts)
    expect(registeredIds.every(id => Object.prototype.hasOwnProperty.call(PRODUCT_SETTING_USER_DICT_METHODS, id))).toBe(true)
    expect(Object.keys(methodContracts).sort()).toEqual(registeredIds.map(id => `productSettingUserDict.${PRODUCT_SETTING_USER_DICT_METHODS[id as keyof typeof PRODUCT_SETTING_USER_DICT_METHODS]}`).sort())
    expect(contracts['product-setting-user-dict-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_USER_DICT_QUERY_PERMISSION)
    expect(contracts['product-setting-user-dict-enable']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_USER_DICT_SUBMIT_PERMISSION)
    expect(productSettingUserDictCapabilities.map(item => item.id)).toContain('product-setting-user-dict-save')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    const registeredDefinitions = productSettingUserDictCapabilities.filter(item => registeredIds.includes(item.id))
    expect(validateAiContracts(contracts, { definitions: registeredDefinitions, contracts })).toEqual([])
  })
})
