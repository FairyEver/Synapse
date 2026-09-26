import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductProgramLibraryCapability,
  PRODUCT_PROGRAM_LIBRARY_METHODS,
  PRODUCT_PROGRAM_LIBRARY_NEW_METHODS,
  PRODUCT_PROGRAM_LIBRARY_MODULE_TYPE,
  PRODUCT_PROGRAM_LIBRARY_NEW_MODULE_TYPE,
  PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH,
  PRODUCT_PROGRAM_LIBRARY_NEW_PERMISSION,
  PRODUCT_PROGRAM_LIBRARY_PAGE_PATH,
  PRODUCT_PROGRAM_LIBRARY_PERMISSION,
  PRODUCT_PROGRAM_PAGE_KEYS,
  PRODUCT_PROGRAM_PAGE_RULES,
  productProgramLibraryCapabilities,
  productProgramLibraryNewCapabilities,
  type ProductProgramDraft,
  type ProductProgramPageKey,
} from '../src/capabilities/product-program-library.js'
import {
  PRODUCT_PROGRAM_LIBRARY_AI_CONTRACTS as contracts,
  PRODUCT_PROGRAM_LIBRARY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-program-library.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductProgramLibraryCapability(request), calls }
}

function capturePage (pagePath: string) {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
  )
  const api = createProductProgramLibraryCapability(
    config => call(pagePath, config),
  )
  return { api, calls }
}

const expectedApiPaths: Record<ProductProgramPageKey, string> = {
  mianyi: '/flockSimu/rearingPlan/programLibrary/immunization/item',
  touyao: '/flockSimu/rearingPlan/medication',
  xiaodu: '/flockSimu/rearingPlan/disinfection',
  kangti: '/flockSimu/rearingPlan/antibodyMonitoring',
  weisheng: '/flockSimu/rearingPlan/microorganism',
  poujie: '/flockSimu/rearingPlan/necropsy',
  'siliao-jiance': '/flockSimu/rearingPlan/feedTesting',
  yaomin: '/flockSimu/rearingPlan/drugSensitivityTesting',
  tingzhen: '/flockSimu/rearingPlan/respiratoryAuscultation',
  guangzhao: '/flockSimu/rearingPlan/lightProgram',
  wendu: '/flockSimu/rearingPlan/tempHumidity',
  tongfeng: '/flockSimu/rearingPlan/ventilation',
  shujing: '/flockSimu/rearingPlan/insemination',
  qingfen: '/flockSimu/rearingPlan/manure',
  kongchang: '/flockSimu/rearingPlan/emptyHouse',
  huanliao: '/flockSimu/rearingPlan/feedChange',
  dunsi: '/flockSimu/rearingPlan/mealFeeding',
}

const expectedFields: Record<ProductProgramPageKey, string[]> = {
  mianyi: ['dayAgeRange', 'frequencyCode', 'applicableTypes', 'immuneProject', 'vaccineSupplierId', 'immuneMethod', 'immuneSite', 'vaccineType', 'vaccineDose', 'sortNo'],
  touyao: ['dayAgeRange', 'frequencyCode', 'applicableTypes', 'medicationMaterialId', 'medicationSupplierId', 'dosage', 'medicationMethod', 'useDays', 'medicationPurpose', 'remark'],
  xiaodu: ['dayAgeRange', 'frequencyCode', 'disinfectionSite', 'disinfectionFrequency', 'primaryDisinfectantMaterialId', 'secondaryDisinfectantMaterialId', 'remark'],
  kangti: ['dayAgeRange', 'frequencyCode', 'monitoringFrequency', 'antibodyTests', 'antibodyPurposeQuantity', 'pathogenTests', 'pathogenPurposeQuantity', 'remark'],
  weisheng: ['dayAgeRange', 'frequencyCode', 'monitoringEnvironment', 'monitoringProject', 'monitoringFrequency', 'monitoringPointQuantity', 'remark'],
  poujie: ['dayAgeRange', 'frequencyCode', 'necropsySites', 'remark'],
  'siliao-jiance': ['season', 'samples', 'monitoringFrequency', 'remark'],
  yaomin: ['dayAgeRange', 'frequencyCode', 'samplingSites', 'monitoredDiseases', 'remark'],
  tingzhen: ['dayAgeRange', 'frequencyCode', 'auscultationDesc', 'remark'],
  guangzhao: ['startDayAge', 'endDayAge', 'frequencyCode', 'lightMinutes', 'lightIntensityLux', 'darkStartTime', 'darkEndTime', 'adjustmentDesc', 'remark'],
  wendu: ['stageName', 'startDayAge', 'endDayAge', 'frequencyCode', 'minTemperatureCelsius', 'maxTemperatureCelsius', 'minHumidityPercent', 'maxHumidityPercent', 'remark'],
  tongfeng: ['dayAge', 'frequencyCode', 'remark'],
  shujing: ['dayAgeRange', 'stageName', 'workContent', 'operationDetail', 'frequency', 'frequencyCode', 'responsiblePerson', 'remark'],
  qingfen: ['startDayAge', 'endDayAge', 'frequencyCode', 'cleaningCount', 'cleaningDesc', 'remark'],
  kongchang: ['dayAgeRange', 'timeNode', 'workContent', 'operationDetail', 'frequencyCode', 'responsiblePerson', 'sortOrder', 'remark'],
  huanliao: ['variety', 'dayAge', 'frequencyCode', 'henFeed', 'maleFeed', 'sortOrder', 'remark'],
  dunsi: ['dayAge', 'frequencyCode', 'feedingCount', 'feedingTime', 'feedingAmount', 'levelingCount', 'emptyTroughDuration', 'lighting', 'sortOrder', 'remark'],
}

const medicationDraft: ProductProgramDraft = {
  dayAgeRange: '1-7',
  frequencyCode: '1',
  applicableTypes: ['1'],
  medicationMaterialId: '12',
  medicationSupplierId: '34',
  dosage: ' 0.1% ',
  medicationMethod: '1',
  useDays: '5',
  medicationPurpose: ' 预防感染 ',
  remark: ' 备注 ',
}

describe('系统设置→程序库页面能力（两个入口、17个子页）', () => {
  it('逐页锁定菜单、权限、组件复用、默认实例和Java端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/product/operation.js'), 'utf8')
    const listSource = readFileSync(join(portalRoot, 'app/portal/views/dashboard/product/prevention/plan/program-library/list.vue'), 'utf8')
    const wrapperSource = readFileSync(join(portalRoot, 'app/portal/views/dashboard/product/setting/program-lib/list.vue'), 'utf8')
    const programApi = readFileSync(join(portalRoot, 'app/portal/views/dashboard/product/prevention/plan/program-library/program-api.js'), 'utf8')
    const ventilationSource = readFileSync(join(portalRoot, 'app/portal/views/dashboard/product/prevention/plan/program-library/components/program-ventilation-matrix.vue'), 'utf8')
    const libraryController = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/RearingPlanProgramLibraryController.java'), 'utf8')
    const ventilationController = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/RearingPlanVentilationController.java'), 'utf8')
    const preventionController = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/RearingPlanPreventionProgramController.java'), 'utf8')

    expect(menu).toContain(`path: '${PRODUCT_PROGRAM_LIBRARY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_PROGRAM_LIBRARY_PERMISSION}'`)
    expect(menu).toContain(`path: '${PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_PROGRAM_LIBRARY_NEW_PERMISSION}'`)
    expect(wrapperSource).toContain('<ProgramLibraryList permission="/dashboard/frame/breeding-plan-new/program-library" />')
    for (const fragment of [
      'import { http } from \'app/portal/utils/http/platform.js\'',
      'permissionCheck(props.permission)',
      'programLibraryPaths',
      'handleSaveRecords',
      'handleSaveVentilationRows',
      'openRearingPlanImport',
      'submit: false',
      'paramsSerializer: { indexes: null }',
      'export function toProgramPayload',
      'export function toVentilationMatrixPayload',
    ]) expect(`${listSource}\n${programApi}`).toContain(fragment)
    for (const fragment of [
      'fetchVentilationMatrix',
      'createVentilationMatrixRow',
      'updateVentilationMatrixRow',
      'deleteVentilationMatrixRow',
    ]) expect(`${listSource}\n${programApi}`).toContain(fragment)
    for (const fragment of ['validateRows', 'ventilationRate <= 0']) expect(ventilationSource).toContain(fragment)
    expect(libraryController).toContain('@GetMapping("/tabs")')
    expect(libraryController).toContain('@GetMapping("/import-template")')
    expect(ventilationController).toContain('@GetMapping("/matrix")')
    expect(ventilationController).toContain('@PostMapping("/matrix/row")')
    expect(ventilationController).toContain('@PutMapping("/matrix/row")')
    expect(ventilationController).toContain('@DeleteMapping("/matrix/row")')
    expect(ventilationController).toContain('@DeleteMapping("/delete-list")')
    for (const path of ['medication', 'disinfection', 'antibodyMonitoring', 'microorganism', 'necropsy', 'feedTesting', 'drugSensitivityTesting']) {
      expect(preventionController).toContain(`@PostMapping("/${path}/create")`)
      expect(preventionController).toContain(`@GetMapping("/${path}/page")`)
      expect(preventionController).toContain(`@PostMapping("/${path}/import-excel")`)
    }
    const controllerFiles: Record<string, string> = {
      guangzhao: 'RearingPlanLightProgramController.java',
      wendu: 'RearingPlanTempHumidityController.java',
      shujing: 'RearingPlanInseminationController.java',
      qingfen: 'RearingPlanManureController.java',
      kongchang: 'RearingPlanEmptyHouseController.java',
      huanliao: 'RearingPlanFeedChangeController.java',
      dunsi: 'RearingPlanMealFeedingController.java',
      tingzhen: 'RearingPlanRespiratoryAuscultationController.java',
    }
    for (const fileName of Object.values(controllerFiles)) {
      const source = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan', fileName), 'utf8')
      expect(source).toContain('@PostMapping("/create")')
      expect(source).toContain('@GetMapping("/page")')
      expect(source).toContain('@PostMapping("/import-excel")')
    }

    expect(productProgramLibraryCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_PROGRAM_LIBRARY_METHODS))
    expect(productProgramLibraryNewCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_PROGRAM_LIBRARY_NEW_METHODS))
    expect(productProgramLibraryCapabilities.every(item => item.pagePath === PRODUCT_PROGRAM_LIBRARY_PAGE_PATH && item.permission === PRODUCT_PROGRAM_LIBRARY_PERMISSION && item.moduleType === PRODUCT_PROGRAM_LIBRARY_MODULE_TYPE)).toBe(true)
    expect(productProgramLibraryNewCapabilities.every(item => item.pagePath === PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH && item.permission === PRODUCT_PROGRAM_LIBRARY_NEW_PERMISSION && item.moduleType === PRODUCT_PROGRAM_LIBRARY_NEW_MODULE_TYPE)).toBe(true)
    expect(resolveModuleType(PRODUCT_PROGRAM_LIBRARY_PAGE_PATH).moduleType).toBe(PRODUCT_PROGRAM_LIBRARY_MODULE_TYPE)
    expect(resolveModuleType(PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页核对17个列表端点、默认分页、筛选字段和通风矩阵分支', async () => {
    expect(PRODUCT_PROGRAM_PAGE_KEYS).toHaveLength(17)
    for (const pageKey of PRODUCT_PROGRAM_PAGE_KEYS) {
      const f = fixture(pageKey === 'tongfeng'
        ? [{ rows: [], temperatures: [] }]
        : [{ list: [], total: 0 }])
      await expect(f.api.list({ pageKey })).resolves.toMatchObject({ list: [], total: 0 })
      expect(f.calls[0]).toEqual(pageKey === 'tongfeng'
        ? { url: '/flockSimu/rearingPlan/ventilation/matrix', method: 'get' }
        : { url: `${expectedApiPaths[pageKey]}/page`, method: 'get', params: { pageNo: 1, pageSize: 20 } })
      expect(PRODUCT_PROGRAM_PAGE_RULES[pageKey].fields.map(field => field.dataIndex)).toEqual(expectedFields[pageKey])
    }

    const filtered = fixture([{ list: [], total: 0 }])
    await filtered.api.list({ pageKey: 'touyao', pageNo: 2, pageSize: 50, filters: { dayAgeRange: '1-7', medicationName: '药物' } })
    expect(filtered.calls[0]).toEqual({
      url: '/flockSimu/rearingPlan/medication/page',
      method: 'get',
      params: { pageNo: 2, pageSize: 50, dayAgeRange: '1-7', medicationName: '药物' },
    })
    await expect(filtered.api.list({ pageKey: 'touyao', filters: { unsupported: 'x' } })).rejects.toThrow('不支持筛选字段')
    await expect(filtered.api.list({ pageKey: 'touyao', pageSize: 30 })).rejects.toThrow('pageSize')
    expect(filtered.calls).toHaveLength(1)

    const matrix = fixture([{ rows: [{ dayAge: 1, frequencyCode: '1', cells: [{ temperature: 18, ventilationRate: 12 }] }], temperatures: [18, 24] }])
    await expect(matrix.api.list({ pageKey: 'tongfeng' })).resolves.toEqual({
      list: [{ dayAge: 1, frequencyCode: '1', cells: [{ temperature: 18, ventilationRate: 12 }], id: null }],
      total: 1,
      temperatures: [18, 24],
    })
  })

  it('prepare→submit 逐字段复刻普通表单，submit:false和跨字段规则不能绕过', async () => {
    const f = fixture(['new-program-id', true, true, true])
    const prepared = f.api.prepareCreate({ pageKey: 'touyao', draft: medicationDraft })
    expect(prepared).toEqual({
      draft: {
        dayAgeRange: '1-7',
        frequencyCode: '1',
        applicableTypes: ['1'],
        medicationMaterialId: 12,
        dosage: '0.1%',
        medicationMethod: '1',
        useDays: 5,
        medicationPurpose: '预防感染',
        remark: '备注',
      },
    })
    expect(prepared.draft).not.toHaveProperty('medicationSupplierId')
    expect(await f.api.create({ pageKey: 'touyao', draft: medicationDraft })).toBe('new-program-id')
    expect(await f.api.update({ pageKey: 'touyao', draft: { ...medicationDraft, id: 'program-1' } })).toBe(true)
    expect(await f.api.remove({ pageKey: 'touyao', id: 'program-1' })).toBe(true)
    expect(await f.api.removeBatch({ pageKey: 'guangzhao', ids: ['1', 2] })).toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockSimu/rearingPlan/medication/create', method: 'post', data: prepared.draft },
      { url: '/flockSimu/rearingPlan/medication/update', method: 'put', data: { ...prepared.draft, id: 'program-1' } },
      { url: '/flockSimu/rearingPlan/medication/delete', method: 'delete', params: { id: 'program-1' } },
      { url: '/flockSimu/rearingPlan/lightProgram/delete-list', method: 'delete', params: { ids: ['1', 2] }, paramsArrayFormat: 'repeat' },
    ])

    const invalid = fixture([])
    expect(() => invalid.api.prepareCreate({ pageKey: 'touyao', draft: { ...medicationDraft, frequencyCode: '' } })).toThrow('执行频次')
    expect(() => invalid.api.prepareCreate({ pageKey: 'touyao', draft: { ...medicationDraft, dayAgeRange: '701' } })).toThrow('700')
    expect(() => invalid.api.prepareCreate({ pageKey: 'guangzhao', draft: {
      startDayAge: 20, endDayAge: 10, frequencyCode: '1', lightMinutes: 60,
    } })).toThrow('结束日龄')
    expect(() => invalid.api.prepareCreate({ pageKey: 'wendu', draft: {
      stageName: '育成', startDayAge: 1, endDayAge: 2, frequencyCode: '1',
      minTemperatureCelsius: 20, maxTemperatureCelsius: 10, minHumidityPercent: 40, maxHumidityPercent: 60,
    } })).toThrow('最高温度')
    expect(() => invalid.api.prepareCreate({ pageKey: 'tongfeng', draft: {} })).toThrow('矩阵')
    expect(invalid.calls).toEqual([])
  })

  it('通风矩阵逐行复刻空单元过滤、正数校验、原始日龄更新和删除', async () => {
    const f = fixture([true, true, true])
    const row = {
      dayAge: '2',
      frequencyCode: '1',
      cells: [{ temperature: 18, ventilationRate: '' }, { temperature: '24', ventilationRate: '12' }],
      remark: ' 备注 ',
      _originalDayAge: 1,
    }
    expect(f.api.prepareVentilation({ row })).toEqual({
      draft: { dayAge: 2, frequencyCode: '1', cells: [{ temperature: 24, ventilationRate: 12 }], remark: '备注' },
    })
    await expect(f.api.createVentilation({ row })).resolves.toBe(true)
    await expect(f.api.updateVentilation({ row })).resolves.toBe(true)
    await expect(f.api.removeVentilation({ dayAge: '2' })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockSimu/rearingPlan/ventilation/matrix/row', method: 'post', data: { dayAge: 2, frequencyCode: '1', cells: [{ temperature: 24, ventilationRate: 12 }], remark: '备注' } },
      { url: '/flockSimu/rearingPlan/ventilation/matrix/row', method: 'put', data: { dayAge: 2, frequencyCode: '1', cells: [{ temperature: 24, ventilationRate: 12 }], remark: '备注', originalDayAge: 1 } },
      { url: '/flockSimu/rearingPlan/ventilation/matrix/row', method: 'delete', params: { dayAge: 2 } },
    ])
    const invalid = fixture([])
    expect(() => invalid.api.prepareVentilation({ row: { dayAge: 1, frequencyCode: '1', cells: [] } })).toThrow('至少填写')
    expect(() => invalid.api.prepareVentilation({ row: { dayAge: 1, frequencyCode: '1', cells: [{ temperature: 18, ventilationRate: 0 }] } })).toThrow('大于0')
    expect(() => invalid.api.prepareVentilation({ row: { dayAge: 1, frequencyCode: '1', cells: [{ temperature: 18, ventilationRate: 1 }, { temperature: 18, ventilationRate: 2 }] } })).toThrow('不能重复')
    await expect(invalid.api.updateVentilation({ row: { dayAge: 1, frequencyCode: '1', cells: [{ temperature: 18, ventilationRate: 1 }] } })).rejects.toThrow('originalDayAge')
  })

  it('厂家/物料、导出/模板/导入逐字段复刻Portal请求和响应边界', async () => {
    const f = fixture([
      { list: [{ id: 1, status: 1, supplierName: '厂家A' }, { id: 2, status: 0 }], total: 2 },
      { list: [{ id: 3, status: '1', supplierId: 1, matName: '物料A' }], total: 1 },
      { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': "attachment; filename*=UTF-8''投药程序.xls" } },
      { data: new Uint8Array([4, 5]).buffer, headers: {} },
      2,
    ])
    await expect(f.api.suppliers()).resolves.toEqual([{ id: 1, status: 1, supplierName: '厂家A' }])
    await expect(f.api.materials()).resolves.toEqual([{ id: 3, status: '1', supplierId: 1, matName: '物料A' }])
    await expect(f.api.export({ pageKey: 'touyao', pageNo: 2, pageSize: 50, filters: { dayAgeRange: '1-7', medicationName: '药物' } })).resolves.toMatchObject({ fileName: '投药程序.xls', base64: 'AQID', byteLength: 3 })
    await expect(f.api.downloadTemplate({ pageKey: 'touyao' })).resolves.toMatchObject({ fileName: '投药程序模板.xlsx', base64: 'BAU=', byteLength: 2 })
    expect(f.api.prepareImport({ fileName: '程序.xlsx', base64: ' AQID ', contentType: '' })).toEqual({ fileName: '程序.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3, maxRows: 1000 })
    await expect(f.api.importFile({ pageKey: 'touyao', fileName: '程序.xlsx', base64: 'AQID' })).resolves.toBe(2)
    expect(f.calls[0]).toEqual({ url: '/supply/supplier/page', method: 'get', params: { pageNo: 1, pageSize: 100, status: 1 } })
    expect(f.calls[1]).toEqual({ url: '/supply/materiel/page', method: 'get', params: { pageNo: 1, pageSize: 100, status: 1 } })
    expect(f.calls[2]).toEqual({ url: '/flockSimu/rearingPlan/medication/export-excel', method: 'get', params: { dayAgeRange: '1-7', medicationName: '药物' }, responseType: 'arraybuffer' })
    expect(f.calls[3]).toEqual({ url: '/flockSimu/rearingPlan/programLibrary/import-template', method: 'get', params: { programCode: 'medication' }, responseType: 'arraybuffer' })
    expect(f.calls[4]?.url).toBe('/flockSimu/rearingPlan/medication/import-excel')
    expect(f.calls[4]?.method).toBe('post')
    expect(f.calls[4]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    expect(f.calls[4]?.data).toBeInstanceOf(FormData)
    expect((f.calls[4]?.data as FormData).get('file')).toBeInstanceOf(Blob)

    const invalid = fixture([])
    expect(() => invalid.api.prepareImport({ fileName: '程序.xls', base64: 'AQID' })).toThrow('.xlsx')
    expect(() => invalid.api.prepareImport({ fileName: '程序.xlsx', base64: 'bad!' })).toThrow('Base64')
    expect(invalid.calls).toEqual([])
  })

  it('默认platform实例由页面路径决定module-type：主入口45，新入口不发送', async () => {
    const primary = capturePage(PRODUCT_PROGRAM_LIBRARY_PAGE_PATH)
    await expect(primary.api.tabs()).resolves.toEqual([])
    expect(primary.calls[0]?.url).toMatch(/^\/admin-api\/flockSimu\/rearingPlan\/programLibrary\/tabs\?_t=\d+$/)
    expect(primary.calls[0]?.headers?.get('module-type')).toBe(String(PRODUCT_PROGRAM_LIBRARY_MODULE_TYPE))

    const newer = capturePage(PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH)
    await expect(newer.api.tabs()).resolves.toEqual([])
    expect(newer.calls[0]?.url).toMatch(/^\/admin-api\/flockSimu\/rearingPlan\/programLibrary\/tabs\?_t=\d+$/)
    expect(newer.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI说明覆盖两个入口的所有能力、直接方法路径和prepare→submit反证', async () => {
    const allDefinitions = [...productProgramLibraryCapabilities, ...productProgramLibraryNewCapabilities]
    expect(Object.keys(contracts).sort()).toEqual(allDefinitions.map(item => item.id).sort())
    expect(Object.keys(methodContracts).sort()).toEqual([
      ...Object.entries(PRODUCT_PROGRAM_LIBRARY_METHODS).map(([, method]) => `productProgramLibrary.${method}`),
      ...Object.entries(PRODUCT_PROGRAM_LIBRARY_NEW_METHODS).map(([, method]) => `productProgramLibraryNew.${method}`),
    ].sort())
    expect(contracts['product-program-library-create-ventilation']?.steps[0]?.capabilityId).toBe('product-program-library-prepare-ventilation')
    expect(contracts['product-program-library-new-update-ventilation']?.steps[0]?.capabilityId).toBe('product-program-library-new-prepare-ventilation')
    expect(methodContracts['productProgramLibrary.list']?.boundaries.join('\n')).toContain('直接方法路径为 productProgramLibrary.list')

    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: allDefinitions, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: allDefinitions, contracts }) as Array<{ code: string }>
    expect(complete).toHaveLength(allDefinitions.length)
    expect(complete.every(issue => issue.code === 'incomplete-evidence')).toBe(true)

    const createId = 'product-program-library-create'
    const broken = {
      ...contracts,
      [createId]: {
        ...contracts[createId]!,
        steps: contracts[createId]!.steps.map((step, index) => index === 0
          ? { ...step, mapping: { draft: 'result.missing' } }
          : step),
      },
    }
    expect((validateAiContracts(broken, { definitions: allDefinitions, contracts: broken }) as Array<{ code: string }>).map(issue => issue.code)).toContain('unknown-source-field')
  })
})
