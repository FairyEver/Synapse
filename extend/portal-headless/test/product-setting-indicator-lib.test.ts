import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingIndicatorLibCapability,
  PRODUCT_SETTING_INDICATOR_LIB_METHODS,
  PRODUCT_SETTING_INDICATOR_LIB_MODULE_TYPE,
  PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH,
  PRODUCT_SETTING_INDICATOR_LIB_PERMISSION,
  productSettingIndicatorLibCapabilities,
} from '../src/capabilities/product-setting-indicator-lib.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_INDICATOR_LIB_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_INDICATOR_LIB_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-indicator-lib.js'

type RequestConfig = Parameters<PortalRequest>[0]

const definition = {
  id: 'def-1',
  name: '体重',
  code: 'weight',
  category: '1',
  tempBandCode: null,
  unit: 'g',
  decimalPlaces: 1,
  sortOrder: 0,
  indicatorCategoryName: '饲养',
  temperatureRelated: false,
  tempBandName: '',
}

const version = {
  id: 'version-1',
  libraryId: 'library-1',
  generation: '2',
  variety: '1',
  strain: '',
  versionName: 'V1',
  effectiveStart: '2026-09-01T10:00:00',
  effectiveEnd: null,
  latest: true,
  operatorName: '测试用户',
  operationTime: '2026-09-01T10:00:00',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingIndicatorLibCapability(request), calls }
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
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [version], total: 1, latestCount: 1, historyCount: 0 } },
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
  const api = createProductSettingIndicatorLibCapability(
    config => call(PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH, { ...config, httpInstance: 'platform' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 养殖预案 → 指标库-新页面能力', () => {
  it('逐页锁定菜单、列表/详情/配置路由、权限、平台实例和Java请求链路', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/indicator-lib/list.vue')
    const detail = read(portalRoot, 'app/portal/views/dashboard/product/setting/indicator-lib/detail.vue')
    const configure = read(portalRoot, 'app/portal/views/dashboard/product/setting/indicator-lib/configure.vue')
    const utils = read(portalRoot, 'app/portal/views/dashboard/product/setting/indicator-lib/utils.js')
    const standard = read(portalRoot, 'app/portal/views/dashboard/product/setting/indicator-lib/components/StandardModalContent.vue')
    const copy = read(portalRoot, 'app/portal/views/dashboard/product/setting/indicator-lib/components/CopyModalContent.vue')
    const quick = read(portalRoot, 'app/portal/views/dashboard/product/setting/indicator-lib/components/QuickEntryModalContent.vue')
    const configContent = read(portalRoot, 'app/portal/views/dashboard/product/setting/indicator-lib/components/ConfigureModalContent.vue')
    const excel = read(portalRoot, 'app/portal/utils/product/rearing-plan-excel.js')
    const platformHttp = read(portalRoot, 'app/portal/utils/http/platform.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/RearingPlanIndicatorController.java')
    const saveVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanIndicatorSaveReqVO.java')
    const versionVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanIndicatorVersionSaveReqVO.java')
    const dataVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanIndicatorDataSaveReqVO.java')
    const quickVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanIndicatorQuickEntryReqVO.java')
    const definitionVO = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanIndicatorDefinitionSaveReqVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/rearingplan/impl/RearingPlanIndicatorServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH}'`)
    for (const source of [list, detail, configure]) expect(source).toContain(PRODUCT_SETTING_INDICATOR_LIB_PERMISSION)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      'permissionCheck(PAGE_PERMISSION)',
      'http.get(`${INDICATOR_API}/page`',
      "latestOnly: versionScope !== 'all'",
      'http.post(`${INDICATOR_API}/create`',
      'http.put(`${INDICATOR_API}/update`',
      'http.delete(`${INDICATOR_API}/delete`',
      'http.get(`${INDICATOR_API}/get`',
      'http.post(`${INDICATOR_API}/copy`',
      'http.put(`${INDICATOR_API}/version/update`',
      "path: '/dashboard/product/setting/indicator-lib/detail'",
    ]) expect(list).toContain(fragment)
    expect(list).toContain("router.push('/dashboard/product/setting/indicator-lib/configure')")
    for (const fragment of [
      'http.get(`${INDICATOR_API}/get`',
      '${INDICATOR_API}/data/partial-update',
      '${INDICATOR_API}/data/quick-entry',
      'downloadRearingPlanExcel(`${INDICATOR_API}/export-excel`',
      "apiPath: INDICATOR_API",
      'overwrite: true',
      'MAX_DAY_AGE',
      '请至少保留一行指标数据',
      '区间上下限不能为空',
      '当前版本存在未保存的修改',
    ]) expect(detail).toContain(fragment)
    for (const fragment of [
      'http.get(`${INDICATOR_API}/definition/list`',
      'http.put(`${INDICATOR_API}/definition/update`',
      'http.post(`${INDICATOR_API}/definition/create`',
      'http.delete(`${INDICATOR_API}/definition/delete`',
      'http.put(`${INDICATOR_API}/definition/sort`',
      '@submit="handleSubmit"',
    ]) expect(configure).toContain(fragment)
    for (const fragment of [
      "generation: normalizeDictValue(formState.generation)",
      "variety: normalizeDictValue(formState.variety)",
      "strain: lineEnabled.value ? normalizeDictValue(formState.strain) : ''",
      "if (props.mode === 'edit' || props.raw)",
      "versionName: 'V1'",
    ]) expect(standard + list).toContain(fragment)
    for (const fragment of [
      'sourceVersionId: formState.sourceVersionId',
      "strain: lineEnabled.value ? normalizeDictValue(formState.strain) : ''",
      'sourceVersionId: [{ required: true',
    ]) expect(copy + utils).toContain(fragment)
    for (const fragment of ['formState.ranges.length >= 50', 'startDayAge', 'endDayAge', "valueType: 'EXACT'", '最多保留']) expect(quick).toContain(fragment)
    for (const fragment of ['^[a-z][a-z0-9_]{0,63}$', 'decimalPlaces < 0', 'decimalPlaces > 3']) expect(configContent).toContain(fragment)
    expect(configure).toContain('definitionIds')
    for (const fragment of ['responseType: \'blob\'', 'new FormData()', 'overwrite', "${apiPath}/import-excel"]) expect(excel).toContain(fragment)
    for (const fragment of ["import.meta.env.VITE_ZHDJ_PLATFORM_API", 'generateHttpHeaders', "config.url = `/admin-api${config.url}`"]) expect(platformHttp).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("flockSimu/rearingPlan/indicator")',
      '@PostMapping("/create")',
      '@PutMapping("/update")',
      '@PostMapping("/version/create")',
      '@PutMapping("/version/update")',
      '@PostMapping("/copy")',
      '@DeleteMapping("/delete")',
      '@GetMapping("/page")',
      '@GetMapping("/get")',
      '@GetMapping("/import-template")',
      '@GetMapping("/export-excel")',
      '@PostMapping("/import-excel")',
      '@GetMapping("/definition/list")',
      '@PostMapping("/definition/create")',
      '@PutMapping("/definition/update")',
      '@DeleteMapping("/definition/delete")',
      '@PutMapping("/definition/sort")',
      '@PutMapping("/data/partial-update")',
      '@PutMapping("/data/quick-entry")',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['@NotBlank(message = "请选择代次")', 'private String generation', 'private String variety', 'private String strain']) expect(saveVO).toContain(fragment)
    for (const fragment of ['@NotBlank(message = "请输入版本号")', 'private LocalDateTime effectiveStart', 'private LocalDateTime effectiveEnd']) expect(versionVO).toContain(fragment)
    for (const fragment of ['@NotEmpty(message = "请至少录入一行指标数据")', '@Min(value = 1', '@Max(value = 700', 'Map<String, @Valid RearingPlanIndicatorValueVO> values']) expect(dataVO).toContain(fragment)
    for (const fragment of ['@Size(max = 50', 'private String indicatorCode', 'private Integer startDayAge', 'private Integer endDayAge']) expect(quickVO).toContain(fragment)
    for (const fragment of ['^[a-z][a-z0-9_]{0,63}$', 'private Integer decimalPlaces', 'private String tempBandCode']) expect(definitionVO).toContain(fragment)
    for (const fragment of ['partialUpdateData', 'quickEntryData', 'validateEffectivePeriod', 'validateDecimalPlaces', 'validateTempBandBinding', 'copyVersionValues']) expect(service).toContain(fragment)

    expect(productSettingIndicatorLibCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_INDICATOR_LIB_METHODS))
    expect(productSettingIndicatorLibCapabilities.every(item => item.pagePath === PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH && item.permission === PRODUCT_SETTING_INDICATOR_LIB_PERMISSION && item.httpInstance === 'platform' && item.moduleType === PRODUCT_SETTING_INDICATOR_LIB_MODULE_TYPE)).toBe(true)
  })

  it('列表按Portal字段发送筛选、latestOnly和平台分页响应', async () => {
    const f = fixture([{ list: [version], total: 1, latestCount: 1, historyCount: 0 }])
    await expect(f.api.list({ gen: '2', variety: '1', line: 'L1', versionScope: 'all', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1, latestCount: 1, historyCount: 0 })
    expect(f.calls).toEqual([{ url: '/flockSimu/rearingPlan/indicator/page', method: 'get', params: { pageNo: 2, pageSize: 50, latestOnly: false, generation: '2', variety: '1', strain: 'L1' } }])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
  })

  it('新建/编辑复刻代次动态表单、品种必填和品系清空规则', async () => {
    const f = fixture(['new-version', {}])
    expect(f.api.prepareCreate({ generation: 'gg', generationLabel: '曾祖代', variety: 'ignored', strain: 'line' })).toEqual({ draft: { generation: 'gg', variety: 'ignored', strain: 'line', generationLabel: '曾祖代' } })
    const createDraft = f.api.prepareCreate({ generation: 'p', generationLabel: '祖代', variety: 'v', strain: 'l' })
    expect(createDraft).toEqual({ draft: { generation: 'p', variety: 'v', strain: 'l', generationLabel: '祖代' } })
    expect(() => f.api.prepareCreate({ generation: 'p', generationLabel: '祖代' })).toThrow('请选择品种')
    const update = f.api.prepareUpdate({ libraryId: 'library-1', generation: 'g', generationLabel: '商品代', variety: 'v', strain: 'stale' })
    expect(update).toEqual({ draft: { id: 'library-1', generation: 'g', variety: 'v', strain: '', generationLabel: '商品代' } })
    await expect(f.api.create(createDraft)).resolves.toBe('new-version')
    await expect(f.api.update(update)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockSimu/rearingPlan/indicator/create', method: 'post', data: { generation: 'p', variety: 'v', strain: 'l' } },
      { url: '/flockSimu/rearingPlan/indicator/update', method: 'put', data: { id: 'library-1', generation: 'g', variety: 'v', strain: '' } },
    ])
  })

  it('复制、版本编辑、新建版本和单条/批量删除按Portal顺序发送', async () => {
    const f = fixture(['copied-version', true, 'created-version', true, true])
    const copy = f.api.prepareCopy({ sourceVersionId: 'version-1', generation: 'g', generationLabel: '商品代', variety: 'v', strain: 'ignored' })
    expect(copy.draft).toMatchObject({ sourceVersionId: 'version-1', generation: 'g', variety: 'v', strain: '', versionName: 'V1' })
    expect(copy.draft.effectiveStart).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    await expect(f.api.copy(copy)).resolves.toBe('copied-version')
    const versionUpdate = f.api.prepareVersionUpdate({ id: 'version-1', versionName: 'V2', effectiveStart: '2026-09-01 10:00:00', effectiveEnd: null, isLatest: true })
    await expect(f.api.updateVersion(versionUpdate)).resolves.toBe(true)
    const versionCreate = f.api.prepareCreateVersion({ libraryId: 'library-1', versionName: 'V3', effectiveStart: '2026-10-01 10:00:00' })
    await expect(f.api.createVersion(versionCreate)).resolves.toBe('created-version')
    await expect(f.api.remove(f.api.prepareRemove({ versionIds: ['version-a', 'version-b'] }))).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockSimu/rearingPlan/indicator/copy', method: 'post', data: expect.objectContaining({ sourceVersionId: 'version-1', versionName: 'V1' }) },
      { url: '/flockSimu/rearingPlan/indicator/version/update', method: 'put', data: { id: 'version-1', versionName: 'V2', effectiveStart: '2026-09-01 10:00:00', effectiveEnd: null } },
      { url: '/flockSimu/rearingPlan/indicator/version/create', method: 'post', data: { libraryId: 'library-1', versionName: 'V3', effectiveStart: '2026-10-01 10:00:00' } },
      { url: '/flockSimu/rearingPlan/indicator/delete', method: 'delete', params: { versionId: 'version-a' } },
      { url: '/flockSimu/rearingPlan/indicator/delete', method: 'delete', params: { versionId: 'version-b' } },
    ])
    expect(() => f.api.prepareVersionUpdate({ id: 'version-1', versionName: 'V4', effectiveStart: '2026-10-01 10:00:00', isLatest: false })).toThrow('历史版本生效结束时间')
  })

  it('配置页按Portal应用顺序执行更新、创建、删除和排序', async () => {
    const f = fixture([
      { definitions: [definition, { ...definition, id: 'def-old', code: 'old_code', name: '旧指标' }] },
      {},
      'def-2',
      {},
      {},
      { definitions: [definition, { ...definition, id: 'def-2', code: 'height', name: '身高', sortOrder: 1 }] },
    ])
    const draft = f.api.prepareDefinitionConfig({ definitions: [{ ...definition, name: '体重修订' }, { id: '', name: '身高', code: 'height', category: '1', tempBandCode: null, unit: 'cm', decimalPlaces: 0 }] })
    await expect(f.api.applyDefinitionConfig(draft)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'height' })]))
    expect(f.calls).toEqual([
      { url: '/flockSimu/rearingPlan/indicator/definition/list', method: 'get' },
      { url: '/flockSimu/rearingPlan/indicator/definition/update', method: 'put', data: expect.objectContaining({ id: 'def-1', indicatorName: '体重修订' }) },
      { url: '/flockSimu/rearingPlan/indicator/definition/create', method: 'post', data: { indicatorName: '身高', indicatorCode: 'height', indicatorCategory: '1', tempBandCode: null, unit: 'cm', decimalPlaces: 0 } },
      { url: '/flockSimu/rearingPlan/indicator/definition/delete', method: 'delete', params: { id: 'def-old' } },
      { url: '/flockSimu/rearingPlan/indicator/definition/sort', method: 'put', data: { definitionIds: ['def-1', 'def-2'] } },
      { url: '/flockSimu/rearingPlan/indicator/definition/list', method: 'get' },
    ])
    expect(() => f.api.prepareDefinitionConfig({ definitions: [{ ...definition, code: 'Bad-Code' }] })).toThrow('Code须')
    expect(() => f.api.prepareDefinitionConfig({ definitions: [{ ...definition }, { ...definition, id: '', code: 'weight' }] })).toThrow('重复')
  })

  it('增量保存严格复刻四种结构化值、清空单元格、日龄和小数位规则', async () => {
    const f = fixture([{}])
    const draft = f.api.prepareDataUpdate({
      versionId: 'version-1',
      definitions: [definition],
      rows: [{ dayAge: 1, values: { weight: { valueType: 'RANGE', lowerValue: 1.1, upperValue: 2.2 } } }, { dayAge: 2, values: { weight: null } }],
    })
    expect(draft.draft.definitions).toHaveLength(1)
    await expect(f.api.partialUpdate(draft)).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/flockSimu/rearingPlan/indicator/data/partial-update', method: 'put', data: { versionId: 'version-1', rows: draft.draft.rows } }])
    expect(() => f.api.prepareDataUpdate({ versionId: 'version-1', definitions: [{ ...definition, decimalPlaces: 0 }], rows: [{ dayAge: 701, values: { weight: { valueType: 'EXACT', value: 1.1 } } }] })).toThrow('1至700')
    expect(() => f.api.prepareDataUpdate({ versionId: 'version-1', definitions: [{ ...definition, decimalPlaces: 0 }], rows: [{ dayAge: 1, values: { weight: { valueType: 'EXACT', value: 1.1 } } }] })).toThrow('小数')
  })

  it('快速录入只接受Portal表单提交的EXACT数值并限制50组', async () => {
    const f = fixture([{}])
    const draft = f.api.prepareQuickEntry({ versionId: 'version-1', definitions: [definition], entries: [{ indicatorCode: 'weight', startDayAge: 1, endDayAge: 3, indicatorValue: { valueType: 'EXACT', value: 1.2 } }] })
    await expect(f.api.quickEntry(draft)).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/flockSimu/rearingPlan/indicator/data/quick-entry', method: 'put', data: { versionId: 'version-1', entries: draft.draft.entries } }])
    expect(() => f.api.prepareQuickEntry({ versionId: 'version-1', definitions: [definition], entries: [{ indicatorCode: 'weight', startDayAge: 1, endDayAge: 3, indicatorValue: { valueType: 'RANGE' as never, value: 1.2 } }] })).toThrow('EXACT')
  })

  it('Excel模板/导出返回文件，导入按xlsx multipart和versionId发送', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const fileResponse = { data: bytes, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="指标库.xls"' } }
    const f = fixture([fileResponse, fileResponse, 3])
    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ base64: 'AQID', byteLength: 3 })
    await expect(f.api.exportExcel({ versionId: 'version-1' })).resolves.toMatchObject({ fileName: '指标库.xls' })
    await expect(f.api.importExcel({ versionId: 'version-1', file: { fileName: 'values.xlsx', base64: 'AQID' } })).resolves.toBe(3)
    const formData = f.calls[2]?.data as FormData
    expect(f.calls[2]).toMatchObject({ url: '/flockSimu/rearingPlan/indicator/import-excel', method: 'post', params: { versionId: 'version-1' }, headers: { 'Content-Type': 'multipart/form-data' } })
    expect((formData.get('file') as File).name).toBe('values.xlsx')
    await expect(f.api.importExcel({ versionId: 'version-1', file: { fileName: 'values.xls', base64: 'AQID' } })).rejects.toThrow('.xlsx')
  })

  it('平台实例按页面上下文发送admin-api前缀且不发送module-type', async () => {
    const captured = capturePlatform()
    await expect(captured.api.list()).resolves.toMatchObject({ total: 1 })
    expect(captured.calls[0]?.url).toMatch(/^\/admin-api\/flockSimu\/rearingPlan\/indicator\/page\?pageNo=1&pageSize=10&latestOnly=true&_t=\d+$/)
    expect(captured.calls[0]?.headers?.get('module-type')).toBeUndefined()
    expect(captured.calls[0]?.headers?.get('devicetype')).toBeUndefined()
  })

  it('AI契约覆盖公开方法、隐藏详情/配置动作、权限、回查和前后端证据，并已注册', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_INDICATOR_LIB_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_INDICATOR_LIB_METHODS).map(method => `productSettingIndicatorLib.${method}`).sort())
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['product-setting-indicator-lib-data-update']?.boundaries.join('\n')).toContain('partial-update')
    expect(contracts['product-setting-indicator-lib-import']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['$']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingIndicatorLibCapabilities, contracts })).toEqual([])
  })

  it('通用invoke按能力定义把prepare表单映射到SDK方法', async () => {
    const f = fixture([])
    const binding = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-indicator-lib-prepare-create')
    expect(binding).toBeDefined()
    await expect(binding!.run({ productSettingIndicatorLib: f.api } as never, { form: { generation: 'p', generationLabel: '祖代', variety: 'v', strain: 'l' } })).resolves.toEqual({ draft: { generation: 'p', variety: 'v', strain: 'l', generationLabel: '祖代' } })
  })
})
