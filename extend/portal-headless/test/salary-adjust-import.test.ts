import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import {
  createSalaryAdjustImportCapability,
  SALARY_ADJUST_IMPORT_METHODS,
  SALARY_ADJUST_IMPORT_MODULE_TYPE,
  SALARY_ADJUST_IMPORT_PAGE_PATH,
  SALARY_ADJUST_IMPORT_PERMISSION,
  salaryAdjustImportCapabilities,
} from '../src/capabilities/salary-adjust-import.js'
import { SALARY_ADJUST_IMPORT_AI_CONTRACTS as contracts, SALARY_ADJUST_IMPORT_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-salary-adjust-import.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    const result = responses.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createSalaryAdjustImportCapability(request), calls }
}

const base64 = Buffer.from('xlsx').toString('base64')
const row = {
  id: '9007199254740993',
  name: '张三',
  salaryDate: '2026-09',
  staffCode: '20260001',
  fullPath: '集团/研发',
  basicSalary: '10000.00',
  grossSalary: 12000,
  netSalary: '11000.00',
  updaterName: '李四',
  updateTime: '2026-09-24 10:00:00',
}

describe('Portal 薪资管理 → 工资导入页面能力', () => {
  it('逐页锁定菜单、页面动作、Java端点和权限上下文', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/hr/salary/adjust-import/list.vue'), 'utf8')
    const upload = readFileSync(join(root, 'app/portal/views/dashboard/hr/salary/adjust-import/components/create-multiple.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalarySheetController.java'), 'utf8')
    expect(menu).toContain(`path: '${SALARY_ADJUST_IMPORT_PAGE_PATH}'`)
    expect(page).toContain("get('/salary/salarysheet/page'")
    expect(page).toContain("deleteURL: '/salary/salarysheet'")
    expect(page).toContain('deleteIsBatch: true')
    expect(page).toContain("downloadTemplate")
    expect(upload).toContain("accept=\".xlsx\"")
    expect(upload).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(upload).toContain("formData.append('file', file)")
    expect(controller).toContain('@RequestMapping("/salary/salarysheet")')
    expect(controller).toContain('@PostMapping("importExcel")')
    expect(controller).toContain('@DeleteMapping')
    expect(controller).toContain('fileName = "工资导入模板"')
    expect(salaryAdjustImportCapabilities.every(item => item.pagePath === SALARY_ADJUST_IMPORT_PAGE_PATH && item.permission === SALARY_ADJUST_IMPORT_PERMISSION && item.moduleType === SALARY_ADJUST_IMPORT_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表严格复刻Portal的月份归一、组织筛选和分页参数，并保留工资字段', async () => {
    const f = fixture([{ list: [row], total: 1 }, [{ id: 7, name: '研发', children: [] }]])
    await expect(f.api.list({ salaryDate: '2026-09', orgId: 7, pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ list: [{ id: row.id, salaryDate: '2026-09', staffCode: row.staffCode, basicSalary: '10000.00', profitEvaluationSalary: null }], total: 1 })
    await expect(f.api.organizationTree()).resolves.toEqual([{ id: 7, name: '研发', children: [] }])
    expect(f.calls).toEqual([
      { url: '/salary/salarysheet/page', method: 'get', params: { order: '', orderField: '', salaryDate: '2026-09-01', orgId: 7, pageNo: 2, pageSize: 50 } },
      { url: '/org/organization/getRoleOrganizationTree', method: 'get' },
    ])
  })

  it('导入、模板下载和批量删除锁定FormData、实际模板参数与请求体', async () => {
    const response = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment; filename*=UTF-8''%E5%B7%A5%E8%B5%84%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx" } }
    const f = fixture([undefined, response, undefined])
    expect(f.api.prepareImport({ fileName: '工资.xlsx', base64 })).toEqual({ fileName: '工资.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 4 })
    await f.api.importExcel({ fileName: '工资.xlsx', base64 })
    const form = f.calls[0]?.data as FormData
    expect(f.calls[0]).toMatchObject({ url: '/salary/salarysheet/importExcel', method: 'post', headers: { 'Content-Type': 'multipart/form-data' } })
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('file')).toBeInstanceOf(Blob)
    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '工资导入模板.xlsx', byteLength: 3, base64: 'AQID' })
    await f.api.remove({ ids: ['9007199254740993', 7] })
    expect(f.calls[1]).toEqual({ url: '/salary/salarysheet/downloadTemplate', method: 'get', params: { fileName: '考核结果导入模板' }, responseType: 'arraybuffer' })
    expect(f.calls[2]).toEqual({ url: '/salary/salarysheet', method: 'delete', data: ['9007199254740993', 7] })
    expect(f.api.prepareRemove({ ids: [1, '2'] })).toEqual({ ids: [1, '2'] })
  })

  it('坏响应、月份、文件规则和批量ID在请求前失败', async () => {
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture().api.list({ salaryDate: '2026-09-15' })).rejects.toThrow('YYYY-MM')
    await expect(fixture().api.list({ pageSize: 200 })).rejects.toThrow('pageSize')
    await expect(fixture().api.organizationTree()).rejects.toThrow('数组')
    expect(() => fixture().api.prepareImport({ fileName: '工资.xls', base64 })).toThrow('.xlsx')
    expect(() => fixture().api.prepareImport({ fileName: '工资.xlsx', base64: 'bad!' })).toThrow('Base64')
    expect(() => fixture().api.prepareImport({ fileName: '工资.xlsx', base64, contentType: 'application/octet-stream' })).toThrow('MIME')
    expect(() => fixture().api.prepareRemove({ ids: [1, 1] })).toThrow('重复')
  })

  it('AI契约覆盖全部能力与直接门面方法，并锁定写操作回查步骤', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(SALARY_ADJUST_IMPORT_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(SALARY_ADJUST_IMPORT_METHODS).map(method => `salaryAdjustImport.${method}`))])
    expect(contracts['salary-adjust-import-list']?.output.fields.some(item => item.path === 'list[].profitEvaluationSalary')).toBe(true)
    expect(contracts['salary-adjust-import-import']?.steps.some(step => step.capabilityId === 'salary-adjust-import-list')).toBe(true)
    expect(contracts['salary-adjust-import-prepare-import']?.steps.some(step => step.role === 'cancel')).toBe(true)
  })
})
