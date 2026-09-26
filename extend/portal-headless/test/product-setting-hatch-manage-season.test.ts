import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingHatchManageSeasonCapability,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_SUBMIT_PERMISSION,
  productSettingHatchManageSeasonCapabilities,
} from '../src/capabilities/product-setting-hatch-manage-season.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import { PRODUCT_SETTING_HATCH_MANAGE_SEASON_AI_CONTRACTS as contracts, PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-setting-hatch-manage-season.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: 'out-1', tempId: 'in-1', inMin: -10, inMax: 30, inTitle: '-10至30度', outMin: -20, outMax: 40, outTitle: '-20至40度',
  extension: { source: 'portal' },
}
const createForm = { inMin: -10, inMax: 30, outMin: -20, outMax: 40 }
const updateForm = {
  ...row, inMin: -8, inMax: 28, outMin: -18, outMax: 38,
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
  return { api: createProductSettingHatchManageSeasonCapability(request), calls }
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
  const api = createProductSettingHatchManageSeasonCapability(
    config => call(PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 养殖预案 → 温度设置页面能力', () => {
  it('逐页锁定菜单、路由、权限、分支接口、表单、公共分页和Java映射', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/season.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/season/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/season/modal-form-content.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const productHttp = read(portalRoot, 'app/portal/utils/http/product.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/programNew/BaseSettingTempController.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/program/ProgramNewTempInOutDTO.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/vo/ProgramNewTempInOutVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/program/impl/ProgramSuiteServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/ProgramSuiteMapper.xml')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION}'`)
    expect(route).toContain('title: 温度设置')
    expect(route).toContain(PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "query: 'program:season:query'",
      "submit: 'program:season:submit'",
      "delete: 'program:season:delete'",
      "http.get('/programNew/baseSetting/temp/getPage'",
      "http.post('/programNew/baseSetting/temp/create'",
      "http.post('/programNew/baseSetting/temp/edit'",
      "http.get('/programNew/baseSetting/temp/delete'",
      'min: -99',
      'max: 99',
      'scope: 1',
      'getDataListIsPage: true',
      "idKey: 'id'",
      'permissionCheck(permissions.submit)',
      'permissionCheck(permissions.delete)',
      'params: { id: record.id, tempId: record.tempId }',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'id: undefined',
      'tempId: undefined',
      'inMin: undefined',
      'inMax: undefined',
      'outMin: undefined',
      'outMax: undefined',
      'inMin: [{ required: true',
      'inMax: [{ required: true',
      'outMin: [{ required: true',
      'outMax: [{ required: true',
      '...props.raw',
      'id: formState.id',
      'tempId: formState.tempId',
      'inMin: formState.inMin',
      'inMax: formState.inMax',
      'outMin: formState.outMin',
      'outMax: formState.outMax',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of ['order: orderType.value', 'orderField: orderField.value', 'if (getDataListIsPage)', 'params[fieldNamePageNo] = pageNo.value', 'params[fieldNamePageSize] = pageSize.value']) expect(renrenList).toContain(fragment)
    for (const fragment of ["const keys = Object.keys(data)", 'return keys.length === 1 ? data[keys[0]] : data', "devicetype: 'PC'"]) expect(productHttp).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/programNew/baseSetting/temp")',
      '@GetMapping(value = "/getPage")',
      '@PostMapping(value = "/create")',
      '@PostMapping(value = "/edit")',
      '@GetMapping(value = "/delete")',
      '@RequestParam String id',
      '@RequestParam String tempId',
    ]) expect(controller).toContain(fragment)
    for (const field of ['id', 'tempId', 'inTitle', 'outTitle']) expect(dto).toContain(`private String ${field}`)
    for (const field of ['inMin', 'inMax', 'outMin', 'outMax']) expect(dto).toContain(`private Integer ${field}`)
    for (const fragment of ['private Integer min', 'private Integer max']) expect(vo).toContain(fragment)
    for (const fragment of ['updateTempInById', 'updateTempOutById', 'deleteTempIn', 'deleteTempOut', 'insertTempIn', 'insertTempOut']) expect(service).toContain(fragment)
    for (const fragment of ['selectTempInOutList', 'spt.id as tempId', 'sptio.max &gt;= #{min}', 'sptio.min &lt;= #{max}', 'UPDATE fm_simu_program_temperature SET', 'UPDATE fm_simu_program_temperature_in_out SET', 'INSERT INTO fm_simu_program_temperature(', 'INSERT INTO fm_simu_program_temperature_in_out(']) expect(mapper).toContain(fragment)

    expect(productSettingHatchManageSeasonCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS))
    expect(productSettingHatchManageSeasonCapabilities.every(item => item.pagePath === PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH && item.permission === PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_HATCH_MANAGE_SEASON_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_SETTING_HATCH_MANAGE_SEASON_QUERY_PERMISSION).toBe('program:season:query')
    expect(PRODUCT_SETTING_HATCH_MANAGE_SEASON_SUBMIT_PERMISSION).toBe('program:season:submit')
    expect(PRODUCT_SETTING_HATCH_MANAGE_SEASON_DELETE_PERMISSION).toBe('program:season:delete')
  })

  it('列表按Portal逐字段发送默认范围、筛选范围并兼容Java page包络', async () => {
    const f = fixture([{ page: { records: [row], total: 1 } }, { page: { list: [], total: 0 } }])
    await expect(f.api.list({ min: -20, max: 30, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.list({ min: null, max: null })).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls).toEqual([
      { url: '/programNew/baseSetting/temp/getPage', method: 'get', params: { order: '', orderField: '', min: -20, max: 30, scope: 1, pageNo: 2, pageSize: 50 } },
      { url: '/programNew/baseSetting/temp/getPage', method: 'get', params: { order: '', orderField: '', min: null, max: null, scope: 1, pageNo: 1, pageSize: 20 } },
    ])
  })

  it('新建和编辑严格复刻四项必填、温度范围、raw透传和JSON提交', async () => {
    const f = fixture([{}, {}])
    const preparedCreate = f.api.prepareCreate(createForm)
    expect(preparedCreate).toEqual({ draft: { id: undefined, tempId: undefined, ...createForm } })
    await expect(f.api.create(preparedCreate)).resolves.toBe(true)

    const preparedUpdate = f.api.prepareUpdate(updateForm)
    expect(preparedUpdate).toEqual({ draft: updateForm })
    await expect(f.api.update(preparedUpdate)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/programNew/baseSetting/temp/create', method: 'post', data: { id: undefined, tempId: undefined, ...createForm } },
      { url: '/programNew/baseSetting/temp/edit', method: 'post', data: updateForm },
    ])
  })

  it('删除按Portal确认前准备、确认后GET双ID执行', async () => {
    const f = fixture([{}])
    expect(f.api.prepareRemove({ id: row.id, tempId: row.tempId })).toEqual({ id: row.id, tempId: row.tempId })
    await expect(f.api.remove({ id: row.id, tempId: row.tempId })).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/programNew/baseSetting/temp/delete', method: 'get', params: { id: row.id, tempId: row.tempId } }])
  })

  it('坏输入不会发请求，响应和分页边界不会静默降级', async () => {
    const empty = fixture([])
    expect(() => empty.api.prepareCreate({ ...createForm, inMin: null as never })).toThrow('舍内温度最小值')
    expect(() => empty.api.prepareCreate({ ...createForm, outMax: 100 })).toThrow('外界温度最大值')
    expect(() => empty.api.prepareUpdate({ ...updateForm, inMax: null })).toThrow('舍内温度最大值')
    expect(() => empty.api.prepareRemove({ id: row.id, tempId: '' })).toThrow('舍内温度ID')
    await expect(empty.api.list({ min: -100 })).rejects.toThrow('外界温度最小值')
    await expect(empty.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(empty.calls).toEqual([])
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ ...row, outMax: 100 }], total: 1 }]).api.list()).rejects.toThrow('outMax')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/programNew/baseSetting/temp/getPage')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖公开方法、双ID删除、权限、回查步骤和前后端证据，并已注册', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS).map(method => `productSettingHatchManageSeason.${method}`).sort())
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['product-setting-hatch-manage-season-prepare-remove']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['id', 'tempId']))
    expect(contracts['product-setting-hatch-manage-season-remove']?.boundaries.join('\n')).toContain('两个ID')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingHatchManageSeasonCapabilities, contracts })).toEqual([])
  })

  it('通用invoke按参数名适配准备表单，不改变公开方法的直接调用形状', async () => {
    const f = fixture([])
    const binding = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-hatch-manage-season-prepare-create')
    expect(binding).toBeDefined()
    const result = await binding!.run({ productSettingHatchManageSeason: f.api } as never, { form: createForm })
    expect(result).toEqual({ draft: { id: undefined, tempId: undefined, ...createForm } })
  })
})
