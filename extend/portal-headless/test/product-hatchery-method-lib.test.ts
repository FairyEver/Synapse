import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductHatcheryMethodLibCapability,
  PRODUCT_HATCHERY_METHOD_LIB_DELETE_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_METHODS,
  PRODUCT_HATCHERY_METHOD_LIB_MODULE_TYPE,
  PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH,
  PRODUCT_HATCHERY_METHOD_LIB_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_QUERY_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_SUBMIT_PERMISSION,
  productHatcheryMethodLibCapabilities,
} from '../src/capabilities/product-hatchery-method-lib.js'
import { PRODUCT_HATCHERY_METHOD_LIB_AI_CONTRACTS as contracts, PRODUCT_HATCHERY_METHOD_LIB_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-hatchery-method-lib.js'

type RequestConfig = Parameters<PortalRequest>[0]

const temperature = { id: 'temp-1', tempId: 'temp-1', inMin: 18, inMax: 24, inTitle: '18-24℃', outMin: null, outMax: null, outTitle: null }
const row = {
  variety: 'V1', varietyName: '品种一', gen: 'G1', genName: '一代', ageStage: 'A1', ageStageName: '1日龄',
  suiteCode: 'H-G1-V1-A1', flag: null,
}
const file = { fileName: '孵化方法库.xlsx', base64: 'aGVsbG8=', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
const createForm = { variety: 'V1', gen: 'G1', tempId: 'temp-1', file }
const updateForm = { id: '', variety: 'V2', gen: 'G2', tempId: 'temp-2', suiteCode: row.suiteCode }

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductHatcheryMethodLibCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

async function formEntries (value: unknown): Promise<Array<[string, string | { name: string; type: string; bytes: number[] }]>> {
  expect(value).toBeInstanceOf(FormData)
  const result: Array<[string, string | { name: string; type: string; bytes: number[] }]> = []
  for (const [key, item] of (value as FormData).entries()) {
    if (typeof item === 'string') result.push([key, item])
    else result.push([key, { name: item.name, type: item.type, bytes: [...new Uint8Array(await item.arrayBuffer())] }])
  }
  return result
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
  const api = createProductHatcheryMethodLibCapability(
    config => call(PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 孵化预案 → 方法库页面能力', () => {
  it('逐页锁定菜单、路由、复用组件、权限、端点和Java字段差异', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/method-lib.vue')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/method-lib/list.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/modal-form-content.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const productHttp = read(portalRoot, 'app/portal/utils/http/product.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/hatchProgram/HatchMethodLibController.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/program/ProgramNewStandardLibDTO.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/vo/ProgramNewStandardLibVO.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/ProgramSuiteHatchMapperExt.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/program/impl/HatchProgramServiceImpl.java')
    const tempController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/programNew/BaseSettingTempController.java')
    const programManage = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/ProgramManageController.java')

    expect(menu).toContain(`path: '${PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_HATCHERY_METHOD_LIB_PERMISSION}'`)
    expect(route).toContain(PRODUCT_HATCHERY_METHOD_LIB_PERMISSION)
    expect(wrapper).toContain("import HatchManageMethodLibList from 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/list.vue'")
    for (const fragment of [
      "const isHatcheryScene = computed(() => route.path.includes('/setting/hatchery-manage/'))",
      "? '/hatchProgram/methodLib' : '/programNew/methodLib'",
      "'/dashboard/product/setting/hatchery-manage/method-lib/indicator/list'",
      "import { http } from 'app/portal/utils/http/product.js'",
      "query: 'program:method-lib:query'",
      "submit: 'program:method-lib:submit'",
      "delete: 'program:method-lib:delete'",
      "methodLibApiBase.value}/getPage",
      "methodLibApiBase.value}/importMethodLib",
      "methodLibApiBase.value}/edit",
      "methodLibApiBase.value}/delete",
      "'/programNew/baseSetting/temp/getTempInList'",
      "variety: ''",
      "gen: ''",
      "tempId: ''",
      'scope: 1',
      'getDataListIsPage: true',
      "idKey: 'id'",
      'permissionCheck(permissions.submit)',
      'permissionCheck(permissions.delete)',
      "formData.append('variety', payload.variety || '')",
      "formData.append('gen', payload.gen || '')",
      "formData.append('tempId', payload.tempId || '')",
      "formData.append('suiteCode', payload.suiteCode || '')",
      "if (payload.file) formData.append('file', payload.file)",
      "if (payload.flag) formData.append('flag', payload.flag)",
      "rrList.actionFetch()",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'accept=".xlsx,.xls"',
      'function beforeUpload (file)',
      'return Upload.LIST_IGNORE',
      'file: null',
      "newPage(`${import.meta.env.VITE_FM_API}/programManage/exportFile`",
      "fileName: '方法库模板'",
      'const payload = {',
      'file: formState.value.file',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of ['order: orderType.value', 'orderField: orderField.value', 'if (getDataListIsPage)', 'params[fieldNamePageNo] = pageNo.value', 'params[fieldNamePageSize] = pageSize.value']) expect(renrenList).toContain(fragment)
    for (const fragment of [
      "const keys = Object.keys(data)",
      'return keys.length === 1 ? data[keys[0]] : data',
      "devicetype: 'PC'",
    ]) expect(productHttp).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/hatchProgram/methodLib")',
      '@GetMapping(value = "/getPage")',
      '@PostMapping(value = "/edit")',
      '@GetMapping(value = "/delete")',
      '@PostMapping("/importMethodLib")',
      '@GetMapping("/exportMethodLib")',
      'String ageStage',
      'defaultValue = "43"',
      'flag == 0',
      '预案已存在,未选择导入文件，不做更新',
    ]) expect(controller).toContain(fragment)
    for (const field of ['variety', 'varietyName', 'gen', 'genName', 'ageStage', 'ageStageName', 'tempId', 'tempName', 'suiteCode', 'flag']) expect(dto).toContain(`private ${field === 'flag' ? 'Integer' : 'String'} ${field}`)
    for (const fragment of ['private String ageStage', 'private String tempId']) expect(vo).toContain(fragment)
    for (const fragment of ['FROM fm_simu_program_suite_hatch', 'age_stage', 'ageStage != null', 'AND age_stage = #{ageStage}', 'code as suiteCode']) expect(mapper).toContain(fragment)
    for (const fragment of ['getHatchProgramCode(', 'ageStage', 'createProgramSuite(']) expect(controller).toContain(fragment)
    for (const fragment of ['createProgramSuite(', 'updateBySuiteCode(', 'dto.getAgeStage()', 'deleteStandardLib(String suiteCode)']) expect(service).toContain(fragment)
    for (const fragment of ['@GetMapping(value = "/getTempInList")', 'putData("list", list)']) expect(tempController).toContain(fragment)
    expect(programManage).toContain('@GetMapping("/exportFile")')

    expect(productHatcheryMethodLibCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_HATCHERY_METHOD_LIB_METHODS))
    expect(productHatcheryMethodLibCapabilities.every(item => item.pagePath === PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH && item.permission === PRODUCT_HATCHERY_METHOD_LIB_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_HATCHERY_METHOD_LIB_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_HATCHERY_METHOD_LIB_QUERY_PERMISSION).toBe('program:method-lib:query')
    expect(PRODUCT_HATCHERY_METHOD_LIB_SUBMIT_PERMISSION).toBe('program:method-lib:submit')
    expect(PRODUCT_HATCHERY_METHOD_LIB_DELETE_PERMISSION).toBe('program:method-lib:delete')
    expect(Object.keys(PRODUCT_HATCHERY_METHOD_LIB_METHODS).every(id => !id.startsWith('product-setting-hatch-manage-method-lib-') && !id.startsWith('product-hatchery-lib-'))).toBe(true)
  })

  it('温度候选、孵化列表按Portal发送，并保留Java返回的ageStage字段', async () => {
    const f = fixture([{ list: [temperature] }, { page: { records: [row], total: 1 } }])
    await expect(f.api.temperatureOptions()).resolves.toEqual([{ ...temperature, label: temperature.inTitle, value: temperature.id }])
    await expect(f.api.list({ variety: 'V1', gen: 'G1', tempId: 'temp-1', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [{ ...row, id: null, ageStage: row.ageStage, ageStageName: row.ageStageName, tempId: null, tempName: null }], total: 1 })
    expect(f.calls).toEqual([
      { url: '/programNew/baseSetting/temp/getTempInList', method: 'get' },
      { url: '/hatchProgram/methodLib/getPage', method: 'get', params: { order: '', orderField: '', variety: 'V1', gen: 'G1', tempId: 'temp-1', scope: 1, pageNo: 2, pageSize: 50 } },
    ])
  })

  it('新建严格复刻Portal的FormData、可选文件和冲突二阶段', async () => {
    const f = fixture([{ flag: 1 }, {}])
    const prepared = f.api.prepareCreate(createForm)
    expect(prepared.draft).toEqual({ ...createForm, suiteCode: '' })
    await expect(f.api.create({ draft: prepared.draft })).resolves.toEqual({ status: 'conflict', flag: 1 })
    await expect(f.api.create({ draft: prepared.draft, flag: 3 })).resolves.toEqual({ status: 'submitted' })
    expect(await formEntries(f.calls[0]?.data)).toEqual([
      ['variety', 'V1'], ['gen', 'G1'], ['tempId', 'temp-1'], ['suiteCode', ''],
      ['file', { name: '孵化方法库.xlsx', type: file.contentType, bytes: [104, 101, 108, 108, 111] }],
    ])
    expect(await formEntries(f.calls[1]?.data)).toEqual([
      ['variety', 'V1'], ['gen', 'G1'], ['tempId', 'temp-1'], ['suiteCode', ''],
      ['file', { name: '孵化方法库.xlsx', type: file.contentType, bytes: [104, 101, 108, 108, 111] }], ['flag', '3'],
    ])
    expect(f.calls[0]?.url).toBe('/hatchProgram/methodLib/importMethodLib')
    expect(f.calls[1]?.url).toBe('/hatchProgram/methodLib/importMethodLib')
  })

  it('无文件仍按Portal提交tempId，重复响应不被静默当成成功', async () => {
    const f = fixture([{ flag: 1 }])
    const prepared = f.api.prepareCreate({ variety: 'V1', gen: 'G1', tempId: 'temp-1' })
    await expect(f.api.create({ draft: prepared.draft })).resolves.toEqual({ status: 'conflict', flag: 1 })
    expect(await formEntries(f.calls[0]?.data)).toEqual([
      ['variety', 'V1'], ['gen', 'G1'], ['tempId', 'temp-1'], ['suiteCode', ''],
    ])
    expect((f.calls[0]?.data as FormData).get('ageStage')).toBe(null)
  })

  it('编辑、删除和模板下载按孵化端点发送，并要求写后回查', async () => {
    const downloadResponse = {
      data: new Uint8Array([1, 2]).buffer,
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment;filename*=UTF-8''%E6%96%B9%E6%B3%95%E5%BA%93%E6%A8%A1%E6%9D%BF.xlsx" },
    }
    const f = fixture([{}, {}, downloadResponse])
    const prepared = f.api.prepareUpdate(updateForm)
    expect(prepared).toEqual({ draft: { ...updateForm, file: null } })
    await expect(f.api.update(prepared)).resolves.toBe(true)
    expect(f.api.prepareRemove({ suiteCode: row.suiteCode })).toEqual({ suiteCode: row.suiteCode })
    await expect(f.api.remove({ suiteCode: row.suiteCode })).resolves.toBe(true)
    await expect(f.api.downloadTemplate()).resolves.toEqual({ fileName: '方法库模板.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: 'AQI=', byteLength: 2 })
    expect(f.calls).toEqual([
      { url: '/hatchProgram/methodLib/edit', method: 'post', data: { ...updateForm, file: null } },
      { url: '/hatchProgram/methodLib/delete', method: 'get', params: { suiteCode: row.suiteCode } },
      { url: '/programManage/exportFile', method: 'get', params: { fileName: '方法库模板' }, responseType: 'arraybuffer' },
    ])
  })

  it('权限上下文、文件/分页边界和本地反证不放宽', async () => {
    const empty = fixture([])
    expect(() => empty.api.prepareCreate({ ...createForm, variety: '' })).toThrow('品种')
    expect(() => empty.api.prepareCreate({ ...createForm, file: { ...file, fileName: 'bad.txt' } })).toThrow('xls')
    expect(() => empty.api.prepareCreate({ ...createForm, file: { ...file, base64: 'not-base64!' } })).toThrow('Base64')
    expect(() => empty.api.prepareUpdate({ ...updateForm, tempId: '' })).toThrow('舍内温度')
    expect(() => empty.api.prepareRemove({ suiteCode: '' })).toThrow('suiteCode')
    await expect(empty.api.create({ draft: empty.api.prepareCreate(createForm).draft, flag: 4 as never })).rejects.toThrow('flag')
    await expect(empty.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(empty.calls).toEqual([])
    await expect(fixture([{ page: { records: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ page: { records: [{ ...row, suiteCode: 3 }], total: 1 } }]).api.list()).rejects.toThrow('suiteCode')
    await expect(fixture([{ page: { records: [{ ...row, ageStage: 3 }], total: 1 } }]).api.list()).rejects.toThrow('ageStage')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1 })
    expect(captured.calls[0]?.url).toBe('/hatchProgram/methodLib/getPage')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖公开方法、字段错位、冲突步骤、回查和证据边界', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_HATCHERY_METHOD_LIB_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_HATCHERY_METHOD_LIB_METHODS).map(method => `productHatcheryMethodLib.${method}`).sort())
    expect(contracts['product-hatchery-method-lib-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].ageStage', 'list[].tempId', 'list[].suiteCode', 'total']))
    expect(contracts['product-hatchery-method-lib-create']?.boundaries.join('\n')).toContain('tempId')
    expect(contracts['product-hatchery-method-lib-create']?.boundaries.join('\n')).toContain('ageStage')
    expect(contracts['product-hatchery-method-lib-create']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['product-hatchery-method-lib-update']?.steps.some(step => step.capabilityId === 'product-hatchery-method-lib-list')).toBe(true)
    expect(contracts['product-hatchery-method-lib-remove']?.steps.some(step => step.capabilityId === 'product-hatchery-method-lib-list')).toBe(true)
    expect(contracts['product-hatchery-method-lib-list']?.gaps?.join('\n')).toContain('tempId')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productHatcheryMethodLibCapabilities, contracts })).toEqual([])
  })
})
