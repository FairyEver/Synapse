import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingMethodLibCapability,
  PRODUCT_SETTING_METHOD_LIB_METHODS,
  PRODUCT_SETTING_METHOD_LIB_MODULE_TYPE,
  PRODUCT_SETTING_METHOD_LIB_PAGE_PATH,
  PRODUCT_SETTING_METHOD_LIB_PERMISSION,
  productSettingMethodLibCapabilities,
} from '../src/capabilities/product-setting-method-lib.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_METHOD_LIB_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_METHOD_LIB_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-method-lib.js'

type RequestConfig = Parameters<PortalRequest>[0]

const rule = { id: 'rule-1', generation: 'gen-1', variety: 'variety-1', strain: '', startDayAge: 1, intervalDays: 7 }
const row = {
  id: 'method-1',
  methodName: '预防方法',
  methodDescription: '方法描述',
  methodCategory: 'category-1',
  methodType: 1,
  keyPoint: true,
  ruleCount: 1,
  rules: [rule],
  creatorName: '测试用户',
  updateTime: '2026-09-24 10:00:00',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingMethodLibCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function capturePlatform () {
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
    { baseUrls: { platform: 'https://biz-api-test.wodecorp.cn' } },
  )
  const api = createProductSettingMethodLibCapability(
    config => call(PRODUCT_SETTING_METHOD_LIB_PAGE_PATH, { ...config, httpInstance: 'platform' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 养殖预案 → 方法库-新页面能力', () => {
  it('逐页锁定菜单、权限、platform实例、表单入口和Java端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/method-lib/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/method-lib/components/MethodModalContent.vue')
    const utils = read(portalRoot, 'app/portal/views/dashboard/product/setting/method-lib/utils.js')
    const excel = read(portalRoot, 'app/portal/utils/product/rearing-plan-excel.js')
    const importModal = read(portalRoot, 'app/portal/components/portal/product/rearing-plan/ExcelImportModalContent.vue')
    const platformHttp = read(portalRoot, 'app/portal/utils/http/platform.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/RearingPlanMethodController.java')
    const saveVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanMethodSaveReqVO.java')
    const pageVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanMethodPageReqVO.java')
    const respVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanMethodRespVO.java')
    const excelVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanMethodExcelVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/rearingplan/impl/RearingPlanMethodServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_METHOD_LIB_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_METHOD_LIB_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      'permissionCheck(PAGE_PERMISSION)',
      'http.get(`${METHOD_API}/page`',
      'http.post(`${METHOD_API}/create`',
      'http.put(`${METHOD_API}/update`',
      'http.get(`${METHOD_API}/get`',
      'http.delete(`${METHOD_API}/delete`',
      'downloadRearingPlanExcel(`${METHOD_API}/export-excel`',
      'apiPath: METHOD_API',
      "countUnit: '个方法'",
      'params.methodType = Number(methodType)',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'methodName: [',
      'max: 100',
      'max: 2000',
      "METHOD_TYPE_OPTIONS",
      'categoryOptions.value.some',
      'if (!isNormalMethod.value) return []',
      'startDayAge > 500',
      'intervalDays > 100',
      '选择全部代次时不能指定品种或品系',
      '存在重复的适用范围和开始日龄',
      'rules,',
    ]) expect(modal).toContain(fragment)
    for (const fragment of [
      "export const METHOD_API = '/flockSimu/rearingPlan/method'",
      "export const PAGE_PERMISSION = '/dashboard/frame/breeding-plan-new/method-lib'",
      "{ label: '普通方法', value: 1 }",
      "{ label: '程序方法', value: 2 }",
      'methodId',
      'ruleList',
    ]) expect(utils).toContain(fragment)
    for (const fragment of [
      'responseType: \'blob\'',
      'new FormData()',
      '${apiPath}/import-excel',
      'fileDownloadByStreamV2',
    ]) expect(excel).toContain(fragment)
    expect(importModal).toContain('.xlsx')
    for (const fragment of ["import.meta.env.VITE_ZHDJ_PLATFORM_API", 'generateHttpHeaders', "config.url = `/admin-api${config.url}`"]) expect(platformHttp).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("flockSimu/rearingPlan/method")',
      '@PostMapping("/create")',
      '@PutMapping("/update")',
      '@DeleteMapping("/delete")',
      '@GetMapping("/get")',
      '@GetMapping("/page")',
      '@GetMapping("/import-template")',
      '@GetMapping("/export-excel")',
      '@PostMapping("/import-excel")',
      'MAX_BATCH_SIZE',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['@NotBlank', '@Size(max = 100', '@Size(max = 2000', '@Size(max = 32', '@NotNull', 'private Integer methodType', 'private Boolean keyPoint']) expect(saveVO).toContain(fragment)
    for (const fragment of ['private String generation', 'private String variety', 'private String strain', 'private String methodName', 'private Integer methodType']) expect(pageVO).toContain(fragment)
    for (const fragment of ['private String methodName', 'private String methodDescription', 'private String methodCategory', 'private Integer methodType', 'private Boolean keyPoint', 'private List<Rule> rules']) expect(respVO).toContain(fragment)
    for (const fragment of ['方法名称', '方法描述', '方法分类编码', '方法类型', '是否为要点', '开始日龄', '间隔天数']) expect(excelVO).toContain(fragment)
    for (const fragment of ['validateDictDataList', 'validateNormalMethodRules', '程序方法无需配置适用规则', '存在重复的适用范围和开始日龄', 'importMethodList', 'groupingBy']) expect(service).toContain(fragment)

    expect(productSettingMethodLibCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_METHOD_LIB_METHODS))
    expect(productSettingMethodLibCapabilities.every(item => item.pagePath === PRODUCT_SETTING_METHOD_LIB_PAGE_PATH && item.permission === PRODUCT_SETTING_METHOD_LIB_PERMISSION && item.httpInstance === 'platform' && item.moduleType === PRODUCT_SETTING_METHOD_LIB_MODULE_TYPE)).toBe(true)
  })

  it('列表按Portal字段发送分页、筛选和Java分页响应', async () => {
    const f = fixture([{ page: { records: [row], total: 1 } }])
    await expect(f.api.list({ generation: ' gen-1 ', variety: 'variety-1', strain: 'line-1', methodName: ' 预防 ', methodType: '1', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ id: 'method-1', methodType: 1, ruleCount: 1 })] })
    expect(f.calls).toEqual([{ url: '/flockSimu/rearingPlan/method/page', method: 'get', params: { pageNo: 2, pageSize: 50, generation: 'gen-1', variety: 'variety-1', strain: 'line-1', methodName: '预防', methodType: 1 } }])
    await expect(fixture([]).api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
  })

  it('新建和编辑复刻方法类型、必填字段、规则限制和精确JSON提交', async () => {
    const f = fixture(['method-new', true])
    const create = f.api.prepareCreate({ methodName: ' 方法 ', methodDescription: ' 描述 ', methodCategory: ' category-1 ', methodType: 1, keyPoint: 'true', rules: [rule] })
    expect(create.draft).toEqual({ methodName: '方法', methodDescription: '描述', methodCategory: 'category-1', methodType: 1, keyPoint: true, rules: [{ generation: 'gen-1', variety: 'variety-1', strain: '', startDayAge: 1, intervalDays: 7 }] })
    await expect(f.api.create(create)).resolves.toBe('method-new')
    const update = f.api.prepareUpdate({ id: 'method-1', methodName: '更新方法', methodDescription: '新描述', methodCategory: 'category-1', methodType: 2, keyPoint: false, rules: [rule] })
    expect(update.draft.rules).toEqual([])
    await expect(f.api.update(update)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockSimu/rearingPlan/method/create', method: 'post', data: { methodName: '方法', methodDescription: '描述', methodCategory: 'category-1', methodType: 1, keyPoint: true, rules: [{ generation: 'gen-1', variety: 'variety-1', strain: '', startDayAge: 1, intervalDays: 7 }] } },
      { url: '/flockSimu/rearingPlan/method/update', method: 'put', data: { id: 'method-1', methodName: '更新方法', methodDescription: '新描述', methodCategory: 'category-1', methodType: 2, keyPoint: false, rules: [] } },
    ])
    expect(() => f.api.prepareCreate({ methodName: 'a', methodDescription: 'b', methodCategory: 'c', methodType: 1, rules: [] })).toThrow('至少添加')
    expect(() => f.api.prepareCreate({ methodName: 'a', methodDescription: 'b', methodCategory: 'c', methodType: 1, rules: [{ ...rule, startDayAge: 501 }] })).toThrow('1至500')
    expect(() => f.api.prepareCreate({ methodName: 'a', methodDescription: 'b', methodCategory: 'c', methodType: 1, rules: [rule, { ...rule }] })).toThrow('重复')
    expect(() => f.api.prepareCreate({ methodName: 'a', methodDescription: 'b', methodCategory: 'c', methodType: 1, rules: [{ ...rule, generation: '', variety: 'v' }] })).toThrow('全部代次')
  })

  it('详情、删除按Portal的id参数和prepare→submit顺序执行', async () => {
    const f = fixture([row, {}])
    await expect(f.api.get({ id: 'method-1' })).resolves.toMatchObject({ id: 'method-1', rules: [expect.objectContaining({ startDayAge: 1 })] })
    const remove = f.api.prepareRemove({ id: 'method-1' })
    expect(remove).toEqual({ id: 'method-1' })
    await expect(f.api.remove(remove)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockSimu/rearingPlan/method/get', method: 'get', params: { id: 'method-1' } },
      { url: '/flockSimu/rearingPlan/method/delete', method: 'delete', params: { id: 'method-1' } },
    ])
    expect(() => f.api.prepareRemove({ id: '' })).toThrow('方法ID')
  })

  it('模板、导出、导入复刻Portal二进制和xlsx multipart规则', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const templateResponse = { data: bytes, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }
    const exportResponse = { data: bytes, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="方法库.xls"' } }
    const f = fixture([templateResponse, exportResponse, 3])
    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ base64: 'AQID', byteLength: 3, fileName: '方法库导入模板.xlsx' })
    await expect(f.api.exportExcel({ generation: 'gen-1', methodType: 1, pageNo: 9, pageSize: 50 })).resolves.toMatchObject({ fileName: '方法库.xls' })
    await expect(f.api.importExcel({ file: { fileName: 'methods.xlsx', base64: 'AQID' } })).resolves.toBe(3)
    expect(f.calls[1]).toEqual({ url: '/flockSimu/rearingPlan/method/export-excel', method: 'get', params: { generation: 'gen-1', methodType: 1 }, responseType: 'arraybuffer' })
    const formData = f.calls[2]?.data as FormData
    expect(f.calls[2]).toMatchObject({ url: '/flockSimu/rearingPlan/method/import-excel', method: 'post', headers: { 'Content-Type': 'multipart/form-data' } })
    expect((formData.get('file') as File).name).toBe('methods.xlsx')
    await expect(f.api.importExcel({ file: { fileName: 'methods.xls', base64: 'AQID' } })).rejects.toThrow('.xlsx')
  })

  it('平台实例按页面上下文发送admin-api前缀且不发送module-type/devicetype', async () => {
    const captured = capturePlatform()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1 })
    expect(captured.calls[0]?.url).toMatch(/^\/admin-api\/flockSimu\/rearingPlan\/method\/page\?pageNo=1&pageSize=10&_t=\d+$/)
    expect(captured.calls[0]?.headers?.get('module-type')).toBeUndefined()
    expect(captured.calls[0]?.headers?.get('devicetype')).toBeUndefined()
  })

  it('AI契约覆盖公开方法、权限、规则边界、回查和前后端证据，并已注册', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_METHOD_LIB_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_METHOD_LIB_METHODS).map(method => `productSettingMethodLib.${method}`).sort())
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['product-setting-method-lib-create']?.boundaries.join('\n')).toContain('普通方法必须至少一条规则')
    expect(contracts['product-setting-method-lib-import']?.gaps?.join('\n')).toContain('真实测试环境')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingMethodLibCapabilities, contracts })).toEqual([])
  })

  it('通用invoke按能力定义把prepare表单映射到SDK方法', async () => {
    const f = fixture([])
    const binding = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-method-lib-prepare-create')
    expect(binding).toBeDefined()
    await expect(binding!.run({ productSettingMethodLib: f.api } as never, { form: { methodName: 'a', methodDescription: 'b', methodCategory: 'c', methodType: 2 } })).resolves.toEqual({ draft: { methodName: 'a', methodDescription: 'b', methodCategory: 'c', methodType: 2, keyPoint: false, rules: [] } })
  })
})
