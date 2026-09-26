import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductHatcheryMethodLibIndicatorCapability,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_DELETE_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_METHODS,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_MODULE_TYPE,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PAGE_PATH,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_QUERY_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_SUBMIT_PERMISSION,
  productHatcheryMethodLibIndicatorCapabilities,
} from '../src/capabilities/product-hatchery-method-lib-indicator.js'
import {
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_AI_CONTRACTS as contracts,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-hatchery-method-lib-indicator.js'

type RequestConfig = Parameters<PortalRequest>[0]

const option = { code: 'HATCH-1', name: '翻蛋', contentType: 1, title1: '孵化', title2: null, title3: '' }
const row = {
  id: 'trait-1',
  suiteCode: 'H-V1-G1-T1',
  traitType: 27,
  traitTypeName: '孵化方法',
  traitCode: 'HATCH-1',
  traitName: '翻蛋',
  title1: '孵化',
  title2: null,
  title3: '',
  hour: 1,
  stage: 2,
  contentType: 1,
  unit: null,
  min: null,
  max: null,
  txt: '每小时翻蛋',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductHatcheryMethodLibIndicatorCapability(request), calls }
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
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { page: { records: [row], total: 1 } } },
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
  const api = createProductHatcheryMethodLibIndicatorCapability(
    config => call(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 孵化预案 → 方法库 → 查看方法隐藏指标页能力', () => {
  it('锁定隐藏路由、父页面跳转、权限、product实例和前后端端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const parent = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/list.vue')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/method-lib/indicator/list.vue')
    const indicator = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/indicator/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/indicator/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/hatchProgram/HatchMethodLibController.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/program/hatch/HatchProgramLibDTO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/program/impl/HatchProgramServiceImpl.java')

    expect(wrapper).toContain("import HatchManageMethodLibIndicatorList from 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/indicator/list.vue'")
    expect(parent).toContain("'/dashboard/product/setting/hatchery-manage/method-lib/indicator/list'")
    expect(parent).toContain("suiteCode: record.suiteCode || ''")
    for (const fragment of [
      "query: 'program:method-lib-indicator:query'",
      "submit: 'program:method-lib-indicator:submit'",
      "delete: 'program:method-lib-indicator:delete'",
      "http.get(`${methodLibApiBase.value}/getTraitPage`",
      "http.get('/programUnit/getTraitList'",
      "http.post(`${methodLibApiBase.value}/createTrait`",
      "http.post(`${methodLibApiBase.value}/editTrait`",
      "http.get(`${methodLibApiBase.value}/deleteTrait`",
      "${methodLibApiBase.value}/exportMethodLib",
      'searchType: 2',
      'flag: 0',
      'flag: 1',
    ]) expect(indicator).toContain(fragment)
    for (const fragment of ['traitType', 'traitCode', 'contentType', 'title1', 'title2', 'title3', 'age', 'txt', '3000']) expect(modal).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/hatchProgram/methodLib")',
      '@GetMapping(value = "/getTraitPage")',
      '@PostMapping(value = "/createTrait")',
      '@PostMapping(value = "/editTrait")',
      '@GetMapping(value = "/deleteTrait")',
      '@GetMapping("/exportMethodLib")',
      'dto.getHour()',
      'dto.getFlag() == null ? 0 : dto.getFlag()',
    ]) expect(controller).toContain(fragment)
    for (const field of ['id', 'suiteCode', 'traitCode', 'title1', 'title2', 'title3', 'hour', 'stage', 'contentType', 'min', 'max', 'txt', 'flag']) expect(dto).toContain(`private ${field === 'id' || field === 'suiteCode' || field === 'traitCode' || field.startsWith('title') || field === 'txt' ? 'String' : field === 'contentType' || field === 'hour' || field === 'stage' || field === 'flag' ? 'Integer' : 'Double'} ${field}`)
    for (const fragment of ['getTxt(dto.getContentType()', 'programLibHatchMapperExt.updateValueById', 'programLibHatchMapperExt.deleteById', 'selectStandardLibTraitList']) expect(service).toContain(fragment)

    expect(productHatcheryMethodLibIndicatorCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_METHODS))
    expect(productHatcheryMethodLibIndicatorCapabilities.every(item => item.pagePath === PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PAGE_PATH && item.permission === PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_QUERY_PERMISSION).toBe('program:method-lib-indicator:query')
    expect(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_SUBMIT_PERMISSION).toBe('program:method-lib-indicator:submit')
    expect(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_DELETE_PERMISSION).toBe('program:method-lib-indicator:delete')
  })

  it('动态方法名称选项和列表查询按Portal字段发送', async () => {
    const f = fixture([[option], { page: { records: [row], total: 1 } }])
    await expect(f.api.traitCodeOptions({ traitType: 27 })).resolves.toEqual([{ ...option, label: option.name, value: option.code }])
    await expect(f.api.traitCodeOptions()).resolves.toEqual([])
    await expect(f.api.list({ traitType: 27, traitCode: 'HATCH-1', age: 1, suiteCode: row.suiteCode, pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1, list: [{ id: row.id, hour: 1, age: null, suiteCode: row.suiteCode }] })
    expect(f.calls).toEqual([
      { url: '/programUnit/getTraitList', method: 'get', params: { classification: '27', searchType: 2 } },
      { url: '/hatchProgram/methodLib/getTraitPage', method: 'get', params: { traitType: 27, traitCode: 'HATCH-1', age: 1, suiteCode: row.suiteCode, scope: 1, pageNo: 2, pageSize: 50 } },
    ])
  })

  it('新建按JSON冲突二阶段提交，且不把父页FormData流程混入指标页', async () => {
    const f = fixture([{ flag: 1 }, {}])
    const form = { suiteCode: row.suiteCode, traitType: '27', traitCode: 'HATCH-1', contentType: 1, title1: '孵化', title2: '', title3: '', age: 1, txt: '每小时翻蛋' }
    const prepared = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: prepared.draft })).resolves.toEqual({ status: 'conflict', flag: 1 })
    await expect(f.api.create({ draft: prepared.draft, flag: 1 })).resolves.toEqual({ status: 'submitted' })
    expect(f.calls).toEqual([
      { url: '/hatchProgram/methodLib/createTrait', method: 'post', data: { ...prepared.draft, flag: 0 } },
      { url: '/hatchProgram/methodLib/createTrait', method: 'post', data: { ...prepared.draft, flag: 1 } },
    ])
  })

  it('编辑、删除和导出按Portal端点发送，suiteCode仅用于回查', async () => {
    const downloadResponse = {
      data: new Uint8Array([1, 2, 3]).buffer,
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment;filename*=UTF-8''%E6%96%B9%E6%B3%95%E5%BA%93%E6%96%B9%E6%B3%95.xlsx" },
    }
    const f = fixture([{}, {}, downloadResponse])
    const update = f.api.prepareUpdate({ ...row, id: row.id, traitType: '27', age: 1, txt: '已修改', suiteCode: row.suiteCode })
    await expect(f.api.update(update)).resolves.toBe(true)
    const remove = f.api.prepareRemove({ id: row.id, suiteCode: row.suiteCode })
    await expect(f.api.remove(remove)).resolves.toBe(true)
    await expect(f.api.export({ traitType: 27, traitCode: 'HATCH-1', age: 1, suiteCode: row.suiteCode })).resolves.toMatchObject({ fileName: '方法库方法.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls).toEqual([
      { url: '/hatchProgram/methodLib/editTrait', method: 'post', data: { ...update.draft, flag: 1, suiteCode: undefined } },
      { url: '/hatchProgram/methodLib/deleteTrait', method: 'get', params: { id: row.id } },
      { url: '/hatchProgram/methodLib/exportMethodLib', method: 'get', params: { traitType: 27, traitCode: 'HATCH-1', age: 1, suiteCode: row.suiteCode, scope: 1 }, responseType: 'arraybuffer' },
    ])
    expect((f.calls[0]?.data as Record<string, unknown>).suiteCode).toBeUndefined()
  })

  it('边界校验、坏响应和关键反证会阻止静默放宽', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ suiteCode: row.suiteCode, traitType: '27', traitCode: '', age: 1, txt: '内容' })).toThrow('方法名称')
    expect(() => f.api.prepareCreate({ suiteCode: row.suiteCode, traitType: '27', traitCode: 'HATCH-1', age: 0, txt: '内容' })).toThrow('日龄')
    expect(() => f.api.prepareCreate({ suiteCode: row.suiteCode, traitType: '27', traitCode: 'HATCH-1', age: 1, txt: 'a'.repeat(3001) })).toThrow('3000')
    expect(() => f.api.prepareUpdate({ ...row, id: '', traitType: '27', age: 1, txt: '内容' })).toThrow('ID')
    expect(() => f.api.prepareRemove({ id: '' })).toThrow('ID')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.traitCodeOptions({ traitType: '27' })).rejects.toThrow('数组')
    await expect(fixture([{ page: { records: [{ ...row, id: {} }], total: 1 } }]).api.list()).rejects.toThrow('ID')
    expect(f.calls).toHaveLength(1)
  })

  it('product实例发送devicetype且不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1 })
    expect(captured.calls[0]?.url).toBe('/hatchProgram/methodLib/getTraitPage')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖公开方法、冲突步骤、权限和证据边界', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_METHODS).map(method => `productHatcheryMethodLibIndicator.${method}`).sort())
    expect(contracts['product-hatchery-method-lib-indicator-create']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['product-hatchery-method-lib-indicator-create']?.steps.some(step => step.mapping?.flag === 'literal:1')).toBe(true)
    expect(contracts['product-hatchery-method-lib-indicator-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].hour', 'list[].age', 'total']))
    expect(contracts['product-hatchery-method-lib-indicator-create']?.boundaries.join('\n')).toContain('FormData')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productHatcheryMethodLibIndicatorCapabilities, contracts })).toEqual([])
  })
})
