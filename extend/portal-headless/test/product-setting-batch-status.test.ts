import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingBatchStatusCapability,
  PRODUCT_SETTING_BATCH_STATUS_METHODS,
  PRODUCT_SETTING_BATCH_STATUS_MODULE_TYPE,
  PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH,
  PRODUCT_SETTING_BATCH_STATUS_PERMISSION,
  PRODUCT_SETTING_BATCH_STATUS_QUERY_PERMISSION,
  PRODUCT_SETTING_BATCH_STATUS_SUBMIT_PERMISSION,
  productSettingBatchStatusCapabilities,
} from '../src/capabilities/product-setting-batch-status.js'
import {
  PRODUCT_SETTING_BATCH_STATUS_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_BATCH_STATUS_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-batch-status.js'

type RequestConfig = Parameters<PortalRequest>[0]

const query = {
  farm: 'farm-1',
  building: 'building-1',
  stageEndingFlag: 0 as 0 | 1,
  variety: 'variety-1',
  line: 'line-1',
  lineVer: 'v1',
  gen: 'gen-1',
  pageNo: 2,
  pageSize: 50 as const,
}

const row = {
  id: 'flock-1',
  groupId: 101,
  batch: 'B-001',
  farmName: '一场',
  buildingName: '1栋',
  stageStartDate: '2026-09-01',
  stageEndDate: null,
  maleQty: 10,
  femaleQty: 100,
  varietyName: '品种A',
  lineName: '品系A',
  lineVer: 'v1',
  genName: '一代',
  genNucleusName: '核心代',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingBatchStatusCapability(request), calls }
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
  const api = createProductSettingBatchStatusCapability(
    config => call(PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 产品设置 → 鸡群批次状态页面能力', () => {
  it('逐页锁定菜单、product实例、权限、查询表单、动作和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/batch-status/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/batch-status/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/flock/FlockStageStatusController.java')
    const queryVo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/flock/vo/FlockTransferListVO.java')
    const terminationVo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/flock/vo/TerminationBatchVO.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/flock/FlockDTO.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/FlockMapperExt.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/flock/impl/FlockServiceImpl.java')
    const buildingController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/config/BuildingController.java')
    const building = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/config/Building.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_BATCH_STATUS_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_BATCH_STATUS_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_BATCH_STATUS_SUBMIT_PERMISSION}'`,
      "http.get('/flockStatus/list'",
      "http.get('/config/building/getByFarmId'",
      "http.post('/flockStatus/termination'",
      "http.post('/flockStatus/activate'",
      'scope: 1',
      'farm: \'\'',
      "farm: [{ required: true, message: '场区不能为空', trigger: 'change' }]",
      'permissionCheck(permission.submit)',
      'stageEndDate ? record.stageEndDate : \'未终止\'',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "http.get('/flockStatus/recommendEndDay'",
      'status = ref(!!props.raw.stageEndDate)',
      'stageEndDate: [{ required: true, message: \'终止日期不能为空\', trigger: \'change\' }]',
      'disabledDate',
      'formatDay()',
      'groupId: props.raw.groupId',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/flockStatus/")',
      '@GetMapping(value = "/list")',
      '@PostMapping(value = "/termination")',
      '@PostMapping(value = "/activate")',
      '@GetMapping(value = "/recommendEndDay")',
      'putData("page", page)',
      'putData("isConfirm", 1)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['variety', 'line', 'lineVer', 'gen', 'building', 'farm', 'scope', 'stageEndingFlag']) expect(queryVo).toContain(field)
    for (const field of ['groupId', 'stageEndDate', 'isConfirm']) expect(terminationVo).toContain(field)
    for (const field of ['farmName', 'buildingName', 'varietyName', 'lineName', 'genName', 'genNucleusName']) expect(dto).toContain(field)
    for (const fragment of [
      '<select id="selectFlockByPage"',
      'sf.batch',
      'sf.group_id',
      'min(sf.stage_start_date) as stage_start_date',
      'sf.stage_end_date',
      'stage_end_date &gt; now()',
      'stage_end_date &lt;= now()',
      'GROUP BY sf.group_id',
    ]) expect(mapper).toContain(fragment)
    for (const fragment of [
      'terminationBatch(TerminationBatchVO terminationBatchVO)',
      'getIsConfirm() == UNCONFIRMED',
      'flockTransferService.getTransferListBySourceAndPeriod',
      'flockEntryExitService.getEntryExitListByPage',
      'flockDiaryMapperExt.selectByGroupIdAndPeriod',
      'updateByGroupIdSelective(flock)',
      'activateBatch(Long groupId)',
    ]) expect(service).toContain(fragment)
    for (const fragment of ['@GetMapping("/getByFarmId")', 'putData("list", buildingList)']) expect(buildingController).toContain(fragment)
    for (const fragment of ['this.id = id', 'getShortName', 'shortName']) expect(building).toContain(fragment)

    expect(productSettingBatchStatusCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_BATCH_STATUS_METHODS))
    expect(productSettingBatchStatusCapabilities.every(item => item.pagePath === PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH && item.permission === PRODUCT_SETTING_BATCH_STATUS_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_BATCH_STATUS_MODULE_TYPE)).toBe(true)
  })

  it('列表和栋号联动按Portal customLoad逐字段发送', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }, [{ id: 'building-1', shortName: '1栋' }], '2026-09-30'])
    await expect(f.api.list(query)).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.buildingList({ farmId: 'farm-1' })).resolves.toEqual([{ value: 'building-1', label: '1栋' }])
    await expect(f.api.recommendEndDay({ groupId: 101 })).resolves.toBe('2026-09-30')
    expect(f.calls).toEqual([
      {
        url: '/flockStatus/list',
        method: 'get',
        params: { order: '', orderField: '', farm: 'farm-1', building: 'building-1', stageEndingFlag: 0, variety: 'variety-1', line: 'line-1', lineVer: 'v1', gen: 'gen-1', scope: 1, pageNo: 2, pageSize: 50 },
      },
      { url: '/config/building/getByFarmId', method: 'get', params: { farmId: 'farm-1' } },
      { url: '/flockStatus/recommendEndDay', method: 'get', params: { groupId: 101 } },
    ])
  })

  it('prepare→termination先检查→用户确认和恢复逐字段复刻', async () => {
    const f = fixture([1, { msg: '批次终止成功' }, {}])
    expect(f.api.prepareTermination({ groupId: 101, stageStartDate: '2026-09-01', stageEndDate: '2026-09-30' })).toEqual({ draft: { groupId: 101, stageEndDate: '2026-09-30' } })
    const draft = { groupId: 101, stageEndDate: '2026-09-30' }
    await expect(f.api.termination({ draft })).resolves.toEqual({ completed: false, confirmationRequired: true, message: null })
    await expect(f.api.termination({ draft, isConfirm: 1 })).resolves.toEqual({ completed: true, confirmationRequired: false, message: '批次终止成功' })
    await expect(f.api.activate({ groupId: 101 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockStatus/termination', method: 'post', data: { groupId: 101, stageEndDate: '2026-09-30', isConfirm: 0 } },
      { url: '/flockStatus/termination', method: 'post', data: { groupId: 101, stageEndDate: '2026-09-30', isConfirm: 1 } },
      { url: '/flockStatus/activate', method: 'post', data: null, params: { groupId: 101 } },
    ])

    const wrapped = fixture([{ ret: 'SUCCESS', msg: '存在业务记录', data: { isConfirm: 1 } }])
    await expect(wrapped.api.termination({ draft })).resolves.toEqual({ completed: false, confirmationRequired: true, message: '存在业务记录' })
  })

  it('表单、分页、状态、ID、日期边界和坏响应在发请求前或响应处失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ ...query, farm: '' })).rejects.toThrow('场区')
    await expect(f.api.list({ ...query, pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.list({ ...query, stageEndingFlag: 2 as never })).rejects.toThrow('批次状态')
    await expect(f.api.buildingList({ farmId: '' })).rejects.toThrow('ID')
    await expect(f.api.recommendEndDay({ groupId: 0 })).rejects.toThrow('ID')
    expect(() => f.api.prepareTermination({ groupId: 101, stageStartDate: '2026-09-01', stageEndDate: '2026-08-31' })).toThrow('不能早于')
    expect(() => f.api.prepareTermination({ groupId: 101, stageEndDate: '2026-09-31' })).toThrow('YYYY-MM-DD')
    await expect(f.api.termination({ draft: { groupId: 101, stageEndDate: '2026-09-30' }, isConfirm: 2 as never })).rejects.toThrow('isConfirm')
    await expect(f.api.activate({ groupId: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])

    await expect(fixture([{ page: { list: [{ ...row, maleQty: '10' }], total: 1 } }]).api.list(query)).rejects.toThrow('maleQty')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list(query)).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ ...row, groupId: null }], total: 1 }]).api.list(query)).resolves.toEqual({ list: [{ ...row, groupId: null }], total: 1 })
    await expect(fixture([new Error('无权限')]).api.list(query)).rejects.toThrow('无权限')
  })

  it('product实例补请求头且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list({ farm: 'farm-1' })).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/flockStatus/list')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖所有方法、权限、二次确认和回查', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_BATCH_STATUS_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_BATCH_STATUS_METHODS).map(method => `productSettingBatchStatus.${method}`).sort())
    expect(contracts['product-setting-batch-status-termination']?.effect).toBe('write')
    expect(contracts['product-setting-batch-status-termination']?.steps[0]?.mapping).toEqual({ draft: 'args.draft', isConfirm: 'literal:1' })
    expect(contracts['product-setting-batch-status-prepare-termination']?.steps[0]?.capabilityId).toBe('product-setting-batch-status-termination')
    expect(contracts['product-setting-batch-status-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_BATCH_STATUS_QUERY_PERMISSION)
    expect(contracts['product-setting-batch-status-termination']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_BATCH_STATUS_SUBMIT_PERMISSION)
    expect(contracts['product-setting-batch-status-prepare-termination']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['draft.groupId', 'draft.stageEndDate']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingBatchStatusCapabilities, contracts })).toEqual([])
  })
})
