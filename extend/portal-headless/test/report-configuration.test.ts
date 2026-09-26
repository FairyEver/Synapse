import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportConfigurationCapability,
  REPORT_CONFIGURATION_METHODS,
  REPORT_CONFIGURATION_PAGE_PATH,
  REPORT_CONFIGURATION_PERMISSION,
  REPORT_CONFIGURATION_MODULE_TYPE,
  reportConfigurationCapabilities,
} from '../src/capabilities/report-configuration.js'
import {
  REPORT_CONFIGURATION_AI_CONTRACTS as contracts,
  REPORT_CONFIGURATION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-configuration.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportConfigurationCapability(request), calls }
}

const fields = [
  { name: '员工姓名', tableName: 'hr_staff', columnName: 'name', type: 0 },
  { name: '员工号', tableName: 'hr_staff', columnName: 'staff_code', type: 0 },
  { name: '基本工资', tableName: 'salary', columnName: 'base_salary', type: 1 },
]

const template = {
  id: '9007199254740993',
  name: '工资明细',
  type: 3,
  tag: 1,
  description: null,
  lockTopColumnsCount: 2,
  detailList: [
    { id: '10', templateId: '9007199254740993', name: '员工姓名', tableName: 'hr_staff', columnName: 'name', fieldName: 'hrStaffName', sort: 1, isFilterable: 1, filterType: '=', isSortable: 0, isGrouped: 0, type: 0 },
    { id: '11', templateId: '9007199254740993', name: '员工号', tableName: 'hr_staff', columnName: 'staff_code', fieldName: 'hrStaffStaffCode', sort: 2, isFilterable: 0, filterType: '=', isSortable: 0, isGrouped: 0, type: 0 },
  ],
}

const fileResponse: AxiosResponse<ArrayBuffer> = {
  data: Uint8Array.from([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.ms-excel',
    'content-disposition': "attachment;filename*=UTF-8''%E5%B7%A5%E8%B5%84%E6%98%8E%E7%BB%86.xls",
  },
  status: 200,
  statusText: 'OK',
  config: {} as AxiosResponse<ArrayBuffer>['config'],
}

describe('Portal 人力报表 → 报表配置', () => {
  it('锁定菜单、权限、module-type、platform实例和页面可达动作', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    const list = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/report/report-configuration/list.vue`, 'utf8')
    expect(menu).toContain(`path: '${REPORT_CONFIGURATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${REPORT_CONFIGURATION_PERMISSION}'`)
    expect(list).toContain('selectable: true')
    expect(list).toContain('selectCrossPage: true')
    expect(list).toContain("getDataListURL: '/report/template/page'")
    expect(list).toContain("deleteURL: '/report/template'")
    expect(list).toContain("http.post('/report/template/copyReport'")
    expect(list).toContain('// TODO: 接口请求')
    expect(reportConfigurationCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_CONFIGURATION_METHODS))
    expect(reportConfigurationCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'report-configuration-create',
      'report-configuration-update',
      'report-configuration-remove',
      'report-configuration-copy',
    ])
    expect(reportConfigurationCapabilities.every(item => item.pagePath === REPORT_CONFIGURATION_PAGE_PATH && item.permission === REPORT_CONFIGURATION_PERMISSION && item.moduleType === REPORT_CONFIGURATION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(REPORT_CONFIGURATION_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐页面逐接口核对Portal、组件和Java Controller/DTO/Service', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const base = `${portalRoot}/app/portal/views/dashboard/hr/report/report-configuration`
    const list = readFileSync(`${base}/list.vue`, 'utf8')
    const form = readFileSync(`${base}/[mode]/[id].vue`, 'utf8')
    const detail = readFileSync(`${base}/detail/[id].vue`, 'utf8')
    const selectKey = readFileSync(`${base}/component/select-key.vue`, 'utf8')
    const copy = readFileSync(`${base}/component/report-copy.vue`, 'utf8')
    const permission = readFileSync(`${base}/component/permission.vue`, 'utf8')
    const javaBase = `${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report`
    const controller = readFileSync(`${javaBase}/controller/ReportTemplateController.java`, 'utf8')
    const templateDto = readFileSync(`${javaBase}/dto/ReportTemplateDTO.java`, 'utf8')
    const detailDto = readFileSync(`${javaBase}/dto/ReportTemplateDetailDTO.java`, 'utf8')
    const selectDto = readFileSync(`${javaBase}/dto/ReportTemplateSelectDTO.java`, 'utf8')
    const service = readFileSync(`${javaBase}/service/impl/ReportTemplateServiceImpl.java`, 'utf8')
    const salaryController = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryLedgerItemController.java`, 'utf8')
    const fieldDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/ReportTemplateFieldDTO.java`, 'utf8')

    for (const fragment of ["form: {\n    name: '',\n    type: null", 'selectable: true', 'selectCrossPage: true', 'deleteIsBatch: true', "getDataListIsPage: true"]) expect(list).toContain(fragment)
    for (const fragment of ["http.get('/report/template/' + id)", 'detailList.filter(e => e.isFilterable)', 'isFilterable: Number(form.searchKey.includes(e.name))', "filterType: '='", "http.put('/report/template'", "http.post('/report/template'"]) expect(form).toContain(fragment)
    for (const fragment of ["getDataListURL: '/report/template/getDetail'", 'filterable.value.reduce', "newPageWithPlatformAuth(`${import.meta.env.VITE_ZHDJ_PLATFORM_API}/admin-api/report/template/export`"]) expect(detail).toContain(fragment)
    for (const fragment of ["http.get('/salary/ledgerItem/getAllReportField', { params: { type: 0 } })", 'allReportField.value', 'checkedListAll']) expect(selectKey).toContain(fragment)
    for (const fragment of ['allReport', 'max: 30', "formState = ref({"]) expect(copy).toContain(fragment)
    expect(permission).toContain('defineProps')
    for (const fragment of ['@RequestMapping("report/template")', '@GetMapping("page")', '@GetMapping("allReport")', '@GetMapping("{id}")', '@GetMapping("getDetail")', '@PostMapping("copyReport")', '@PostMapping', '@PutMapping', '@DeleteMapping', '@GetMapping("export")']) expect(controller).toContain(fragment)
    for (const field of ['id', 'name', 'type', 'tag', 'description', 'lockTopColumnsCount', 'detailList']) expect(templateDto).toContain(` ${field};`)
    for (const field of ['tableName', 'columnName', 'name', 'sort', 'fieldName', 'filterType', 'isFilterable', 'isSortable', 'isGrouped', 'type']) expect(detailDto).toContain(` ${field};`)
    for (const field of ['name', 'type', 'pageNo', 'limit', 'pageSize']) expect(selectDto).toContain(` ${field};`)
    for (const fragment of ['pageInfo', 'allReport', 'getInfo', 'saveReport', 'updateReport', 'copyReport', 'selectDetail', 'saveAndGenerateSql', 'reportQuerySqlService.copyReportSql']) expect(service).toContain(fragment)
    expect(controller).toContain('params.put("hrStaffName", null)')
    for (const fragment of ['getAllReportField(Integer type)', 'type = type == null ? 0 : type', 'getAllReportField(type)']) expect(salaryController).toContain(fragment)
    for (const field of ['name', 'tableName', 'columnName', 'type']) expect(fieldDto).toContain(` ${field};`)
  })

  it('复刻列表、全部候选、字段候选和详情请求参数及返回字段', async () => {
    const f = fixture([{ list: [template], total: 1 }, [template], fields, template])
    await expect(f.api.list({ name: '工资', type: 3, pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ list: [{ id: '9007199254740993', type: '3', tag: '1' }], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/report/template/page', method: 'get', params: { order: '', orderField: '', name: '工资', type: '3', pageNo: 2, pageSize: 50 } })
    await expect(f.api.all()).resolves.toMatchObject([{ id: '9007199254740993', name: '工资明细' }])
    expect(f.calls[1]).toEqual({ url: '/report/template/allReport', method: 'get' })
    await expect(f.api.reportFields()).resolves.toEqual(fields)
    expect(f.calls[2]).toEqual({ url: '/salary/ledgerItem/getAllReportField', method: 'get', params: { type: 0 } })
    const actual = await f.api.get({ id: '9007199254740993' })
    expect(actual.id).toBe('9007199254740993')
    expect(actual.detailList?.[0]).toMatchObject({ fieldName: 'hrStaffName' })
    expect(f.calls[3]).toEqual({ url: '/report/template/9007199254740993', method: 'get' })

    const defaults = fixture([{ list: [], total: 0 }])
    await defaults.api.list()
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', name: '', type: null, pageNo: 1, pageSize: 20 })
    await expect(defaults.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(defaults.api.list({ type: {} as never })).rejects.toThrow('type')
    expect(defaults.calls).toHaveLength(1)
  })

  it('动态明细按模板字段传参，导出复刻同一筛选体并解析二进制文件', async () => {
    const f = fixture([[{ hrStaffName: '张三', salaryBaseSalary: '100.00', extra: null }], fileResponse])
    await expect(f.api.getDetail({ id: 9, year: '2026', month: '9', filters: { hrStaffName: '张三', salaryBaseSalary: '', undefinedValue: undefined } })).resolves.toEqual([{ hrStaffName: '张三', salaryBaseSalary: '100.00', extra: null }])
    expect(f.calls[0]).toEqual({ url: '/report/template/getDetail', method: 'get', params: { id: 9, year: '2026', month: '9', hrStaffName: '张三', salaryBaseSalary: '' } })
    await expect(f.api.export({ id: 9, year: '2026', month: '9', filters: { hrStaffName: '张三' } })).resolves.toMatchObject({ fileName: '工资明细.xls', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
    expect(f.calls[1]).toEqual({ url: '/report/template/export', method: 'get', params: { id: 9, year: '2026', month: '9', hrStaffName: '张三' }, responseType: 'arraybuffer' })
    await expect(f.api.getDetail({ id: 9, filters: { 'bad-key': 'x' } })).rejects.toThrow('键名非法')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export({ id: 9 })).rejects.toThrow('空文件')
  })

  it('prepare/create/update严格复刻页面字段顺序、searchKey到isFilterable映射和确认前无请求', async () => {
    const input = { name: '工资明细', type: 3, tag: 1, lockTopColumnsCount: 2, fields, filterFieldNames: ['员工号'] }
    const f = fixture([undefined, undefined])
    expect(f.api.prepareCreate(input)).toEqual({ draft: { name: '工资明细', type: '3', tag: '1', lockTopColumnsCount: 2, detailList: [
      { name: '员工姓名', tableName: 'hr_staff', columnName: 'name', type: 0, isFilterable: 0, filterType: '=' },
      { name: '员工号', tableName: 'hr_staff', columnName: 'staff_code', type: 0, isFilterable: 1, filterType: '=' },
      { name: '基本工资', tableName: 'salary', columnName: 'base_salary', type: 1, isFilterable: 0, filterType: '=' },
    ] } })
    expect(f.calls).toEqual([])
    await f.api.create(input)
    expect(f.calls[0]).toEqual({ url: '/report/template', method: 'post', data: { name: '工资明细', type: '3', tag: '1', lockTopColumnsCount: 2, detailList: [
      { name: '员工姓名', tableName: 'hr_staff', columnName: 'name', type: 0, isFilterable: 0, filterType: '=' },
      { name: '员工号', tableName: 'hr_staff', columnName: 'staff_code', type: 0, isFilterable: 1, filterType: '=' },
      { name: '基本工资', tableName: 'salary', columnName: 'base_salary', type: 1, isFilterable: 0, filterType: '=' },
    ] } })
    const update = { ...input, id: '9', name: '工资明细2' }
    const preparedUpdate = f.api.prepareUpdate(update).draft
    expect(preparedUpdate).toMatchObject({ name: '工资明细2', type: '3', tag: '1' })
    const preparedDetails = preparedUpdate.detailList as Array<Record<string, unknown>>
    expect(preparedDetails[0]).toMatchObject({ isFilterable: 0 })
    expect(preparedDetails[1]).toMatchObject({ isFilterable: 1 })
    await f.api.update(update)
    expect(f.calls[1]).toMatchObject({ url: '/report/template', method: 'put', data: { id: '9', name: '工资明细2', tag: '1' } })
    await expect(f.api.create({ ...input, name: '   ' })).rejects.toThrow('不能全为空格')
    await expect(f.api.create({ ...input, name: 'x'.repeat(51) })).rejects.toThrow('最多50')
    await expect(f.api.create({ ...input, tag: 3 as never })).rejects.toThrow('tag必须为1或2')
    await expect(f.api.create({ ...input, fields: [], filterFieldNames: ['员工号'] })).rejects.toThrow('不在fields中')
    await expect(f.api.create({ ...input, lockTopColumnsCount: -1 })).rejects.toThrow('非负整数')
    expect(f.calls).toHaveLength(2)
  })

  it('删除和复制均要求显式prepare/确认，复制使用multipart id/name', async () => {
    const f = fixture([undefined, undefined])
    expect(f.api.prepareRemove({ ids: ['9', 10] })).toEqual({ ids: ['9', 10] })
    expect(() => f.api.prepareRemove({ ids: ['9', '9'] })).toThrow('不能包含重复')
    expect(() => f.api.prepareRemove({ ids: [] })).toThrow('至少包含')
    await f.api.remove({ ids: ['9', 10] })
    expect(f.calls[0]).toEqual({ url: '/report/template', method: 'delete', data: ['9', 10] })
    expect(f.api.prepareCopy({ id: 9, name: '工资明细副本' })).toEqual({ draft: { id: 9, name: '工资明细副本' } })
    await f.api.copy({ id: 9, name: '工资明细副本' })
    const data = f.calls[1]?.data as FormData
    expect(data.get('id')).toBe('9')
    expect(data.get('name')).toBe('工资明细副本')
    expect(f.calls[1]).toMatchObject({ url: '/report/template/copyReport', method: 'post', headers: { 'Content-Type': 'multipart/form-data' } })
    await expect(f.api.copy({ id: 9, name: 'x'.repeat(31) })).rejects.toThrow('最多30')
    expect(f.calls).toHaveLength(2)
  })

  it('AI契约覆盖每个页面动作、动态字段、权限边界和写入核实步骤', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_CONFIGURATION_METHODS))
    expect(Object.keys(methodContracts)).toEqual([
      'reportConfiguration.list', 'reportConfiguration.all', 'reportConfiguration.reportFields', 'reportConfiguration.get', 'reportConfiguration.getDetail', 'reportConfiguration.export',
      'reportConfiguration.prepareCreate', 'reportConfiguration.create', 'reportConfiguration.prepareUpdate', 'reportConfiguration.update', 'reportConfiguration.prepareRemove', 'reportConfiguration.remove', 'reportConfiguration.prepareCopy', 'reportConfiguration.copy',
    ])
    expect(contracts['report-configuration-get-detail']?.output.dynamic?.sdkPath).toBe('reportConfiguration.get')
    expect(contracts['report-configuration-get-detail']?.output.dynamic?.instructions).toContain('fieldName')
    expect(contracts['report-configuration-prepare-create']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['report-configuration-create']?.steps[0]?.capabilityId).toBe('report-configuration-list')
    expect(contracts['report-configuration-prepare-copy']?.inputs.name?.constraints).toContain('最多30字符')
    expect(contracts['report-configuration-list']?.boundaries.join('\n')).toContain('权限按钮')
    expect(contracts['report-configuration-get-detail']?.gaps?.join('\n')).toContain('强制置null')
    expect(contracts['report-configuration-prepare-remove']?.effect).toBe('prepare')
    expect(contracts['report-configuration-remove']?.effect).toBe('write')
  })
})
