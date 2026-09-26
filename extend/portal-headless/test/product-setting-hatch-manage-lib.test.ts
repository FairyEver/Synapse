import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingHatchManageLibCapability,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_SUBMIT_PERMISSION,
  productSettingHatchManageLibCapabilities,
} from '../src/capabilities/product-setting-hatch-manage-lib.js'
import { PRODUCT_SETTING_HATCH_MANAGE_LIB_AI_CONTRACTS as contracts, PRODUCT_SETTING_HATCH_MANAGE_LIB_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-setting-hatch-manage-lib.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'

type RequestConfig = Parameters<PortalRequest>[0]

const temperature = { id: 'temp-1', tempId: 'temp-1', inMin: 18, inMax: 24, inTitle: '18-24℃', outMin: null, outMax: null, outTitle: null }
const row = {
  variety: 'V1', varietyName: '品种一', gen: 'G1', genName: '一代', ageStage: null, ageStageName: null,
  tempId: 'temp-1', tempName: '18-24℃', suiteCode: 'G1V1-temp-1', flag: null,
}
const file = { fileName: '标准库.xlsx', base64: 'aGVsbG8=', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
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
  return { api: createProductSettingHatchManageLibCapability(request), calls }
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
  const api = createProductSettingHatchManageLibCapability(
    config => call(PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 养殖预案 → 标准库页面能力', () => {
  it('逐页锁定菜单、路由、权限、表单、公共分页和Java映射', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/lib.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/lib/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/lib/modal-form-content.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const productHttp = read(portalRoot, 'app/portal/utils/http/product.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/programNew/StandardLibController.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/program/ProgramNewStandardLibDTO.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/ProgramSuiteMapper.xml')
    const tempController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/programNew/BaseSettingTempController.java')
    const programManage = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/ProgramManageController.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/program/impl/ProgramNewServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION}'`)
    expect(route).toContain('title: 标准库')
    expect(route).toContain(PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "query: 'program:suite:query'",
      "submit: 'program:suite:submit'",
      "delete: 'program:suite:delete'",
      "variety: ''",
      "gen: ''",
      "tempId: ''",
      'scope: 1',
      "'/programNew/baseSetting/temp/getTempInList'",
      "'/programNew/standardLib/getPage'",
      "'/programNew/standardLib/importStandardLib'",
      "'/programNew/standardLib/edit'",
      "'/programNew/standardLib/delete'",
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
      "query: {",
      "path: '/dashboard/product/setting/hatch-manage/lib/indicator/list'",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'accept=".xlsx,.xls"',
      'function beforeUpload (file)',
      "return Upload.LIST_IGNORE",
      "file: null",
      "newPage(`${import.meta.env.VITE_FM_API}/programManage/exportFile`",
      "fileName: '标准库模板'",
      "if (!isEdit.value && !formState.value.file)",
      'file: formState.value.file',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of ['order: orderType.value', 'orderField: orderField.value', 'if (getDataListIsPage)', 'params[fieldNamePageNo] = pageNo.value', 'params[fieldNamePageSize] = pageSize.value']) expect(renrenList).toContain(fragment)
    for (const fragment of [
      "const keys = Object.keys(data)",
      'return keys.length === 1 ? data[keys[0]] : data',
      "devicetype: 'PC'",
    ]) expect(productHttp).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/programNew/standardLib")',
      '@GetMapping(value = "/getPage")',
      '@PostMapping(value = "/edit")',
      '@GetMapping(value = "/delete")',
      '@PostMapping("/importStandardLib")',
      'flag == 0',
      'flag 1替换，2增加（冲突不覆盖），3覆盖（冲突覆盖）',
    ]) expect(controller).toContain(fragment)
    for (const field of ['variety', 'varietyName', 'gen', 'genName', 'tempId', 'tempName', 'suiteCode', 'flag']) expect(dto).toContain(`private ${field === 'flag' ? 'Integer' : 'String'} ${field}`)
    for (const fragment of ['selectStandardLibList', 'sps.variety', 'sps.gen', 'sps.code as suiteCode', 'spt.id as tempId', 'spt.title as tempName', 'sps.temperature_range_id = #{tempId}']) expect(mapper).toContain(fragment)
    for (const fragment of ['@GetMapping(value = "/getTempInList")', 'putData("list", list)']) expect(tempController).toContain(fragment)
    for (const fragment of ['@GetMapping("/exportFile")', 'programLibCompanyService.exportFile(fileName, response)']) expect(programManage).toContain(fragment)
    for (const fragment of ['editStandardLib', 'dto.getSuiteCode()', 'deleteStandardLib', 'updateProgramSuite']) expect(service).toContain(fragment)

    expect(productSettingHatchManageLibCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS))
    expect(productSettingHatchManageLibCapabilities.every(item => item.pagePath === PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH && item.permission === PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_HATCH_MANAGE_LIB_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_SETTING_HATCH_MANAGE_LIB_QUERY_PERMISSION).toBe('program:suite:query')
    expect(PRODUCT_SETTING_HATCH_MANAGE_LIB_SUBMIT_PERMISSION).toBe('program:suite:submit')
    expect(PRODUCT_SETTING_HATCH_MANAGE_LIB_DELETE_PERMISSION).toBe('program:suite:delete')
  })

  it('温度选项、列表按Portal逐字段发送并兼容Java page包络', async () => {
    const f = fixture([{ list: [temperature] }, { page: { list: [row], total: 1 } }])
    await expect(f.api.temperatureOptions()).resolves.toEqual([{ ...temperature, label: temperature.inTitle, value: temperature.id }])
    await expect(f.api.list({ variety: 'V1', gen: 'G1', tempId: 'temp-1', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [{ ...row, id: null }], total: 1 })
    expect(f.calls).toEqual([
      { url: '/programNew/baseSetting/temp/getTempInList', method: 'get' },
      { url: '/programNew/standardLib/getPage', method: 'get', params: { order: '', orderField: '', variety: 'V1', gen: 'G1', tempId: 'temp-1', scope: 1, pageNo: 2, pageSize: 50 } },
    ])
  })

  it('新建严格复刻FormData顺序、文件规则和重复预案二阶段', async () => {
    const f = fixture([{ flag: 1 }, {}])
    const prepared = f.api.prepareCreate(createForm)
    expect(prepared.draft).toEqual({ ...createForm, suiteCode: '', file })
    await expect(f.api.create({ draft: prepared.draft })).resolves.toEqual({ status: 'conflict', flag: 1 })
    await expect(f.api.create({ draft: prepared.draft, flag: 3 })).resolves.toEqual({ status: 'submitted' })
    expect(f.calls[0]).toMatchObject({ url: '/programNew/standardLib/importStandardLib', method: 'post', headers: { 'Content-Type': 'multipart/form-data' } })
    expect(await formEntries(f.calls[0]?.data)).toEqual([
      ['variety', 'V1'], ['gen', 'G1'], ['tempId', 'temp-1'], ['suiteCode', ''],
      ['file', { name: '标准库.xlsx', type: file.contentType, bytes: [104, 101, 108, 108, 111] }],
    ])
    expect(await formEntries(f.calls[1]?.data)).toEqual([
      ['variety', 'V1'], ['gen', 'G1'], ['tempId', 'temp-1'], ['suiteCode', ''],
      ['file', { name: '标准库.xlsx', type: file.contentType, bytes: [104, 101, 108, 108, 111] }], ['flag', '3'],
    ])
  })

  it('编辑和删除按Portal的JSON与GET规则发送', async () => {
    const f = fixture([{}, {}])
    const prepared = f.api.prepareUpdate(updateForm)
    expect(prepared).toEqual({ draft: { ...updateForm, file: null } })
    await expect(f.api.update(prepared)).resolves.toBe(true)
    expect(f.api.prepareRemove({ suiteCode: row.suiteCode })).toEqual({ suiteCode: row.suiteCode })
    await expect(f.api.remove({ suiteCode: row.suiteCode })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/programNew/standardLib/edit', method: 'post', data: { ...updateForm, file: null } },
      { url: '/programNew/standardLib/delete', method: 'get', params: { suiteCode: row.suiteCode } },
    ])
  })

  it('下载模板返回二进制描述，并锁定所有本地反证', async () => {
    const f = fixture([{ data: new Uint8Array([1, 2]).buffer, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment;filename*=UTF-8''%E6%A0%87%E5%87%86%E5%BA%93%E6%A8%A1%E6%9D%BF.xlsx" } }])
    await expect(f.api.downloadTemplate()).resolves.toEqual({ fileName: '标准库模板.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: 'AQI=', byteLength: 2 })
    expect(f.calls[0]).toEqual({ url: '/programManage/exportFile', method: 'get', params: { fileName: '标准库模板' }, responseType: 'arraybuffer' })

    const empty = fixture([])
    expect(() => empty.api.prepareCreate({ ...createForm, variety: '' })).toThrow('品种')
    expect(() => empty.api.prepareCreate({ ...createForm, file: { ...file, fileName: 'bad.txt' } })).toThrow('xls')
    expect(() => empty.api.prepareCreate({ ...createForm, file: { ...file, base64: 'not-base64!' } })).toThrow('Base64')
    expect(() => empty.api.prepareUpdate({ ...updateForm, suiteCode: '' })).toThrow('suiteCode')
    expect(() => empty.api.prepareRemove({ suiteCode: '' })).toThrow('suiteCode')
    await expect(empty.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(empty.calls).toEqual([])
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ ...row, suiteCode: 3 }], total: 1 }]).api.list()).rejects.toThrow('suiteCode')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [{ ...row, id: null }], total: 1 })
    expect(captured.calls[0]?.url).toBe('/programNew/standardLib/getPage')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖公开方法、二阶段提交、权限和前后端证据', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS).map(method => `productSettingHatchManageLib.${method}`).sort())
    expect(contracts['product-setting-hatch-manage-lib-create']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['status', 'flag']))
    expect(contracts['product-setting-hatch-manage-lib-create']?.boundaries.join('\n')).toContain('替换、增加或覆盖')
    expect(contracts['product-setting-hatch-manage-lib-remove']?.boundaries.join('\n')).toContain('不是DELETE')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingHatchManageLibCapabilities, contracts })).toEqual([])
  })

  it('通用invoke按参数名适配准备表单，不改变公开方法的直接调用形状', async () => {
    const f = fixture([])
    const binding = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-hatch-manage-lib-prepare-create')
    expect(binding).toBeDefined()
    const result = await binding!.run({ productSettingHatchManageLib: f.api } as never, { form: createForm })
    expect(result).toEqual({ draft: { ...createForm, suiteCode: '', file } })
  })
})
