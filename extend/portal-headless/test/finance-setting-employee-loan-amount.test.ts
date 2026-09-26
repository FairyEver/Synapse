import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingEmployeeLoanAmountCapability,
  financeSettingEmployeeLoanAmountCapabilities,
  FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHODS,
  FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PAGE_PATH,
  type FinanceSettingEmployeeLoanAmountRow,
} from '../src/capabilities/finance-setting-employee-loan-amount.js'
import {
  FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_AI_CONTRACTS as contracts,
  FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-employee-loan-amount.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceSettingEmployeeLoanAmountRow = {
  id: '9007199254740993',
  employeeName: '张三',
  employeeNo: 'EMP001',
  idCardNo: '370828198505210629',
  phone: '13800138000',
  gender: 1,
  genderName: '男',
  age: 35,
  organizationId: '9007199254740995',
  organizationName: '财务部',
  position: '会计',
  employeeType: 1,
  employeeTypeName: '内部',
  loanQuota: '10000.00',
  debtAmount: '2000.00',
  availableQuota: '8000.00',
  quotaStartDate: '2025-01-01',
  quotaEndDate: '2025-12-31',
  quotaPeriod: '2025-01-01至2025-12-31',
  createTime: '2026-09-23 10:00:00',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingEmployeeLoanAmountCapability(request), calls }
}

describe('财务设置→员工借款额度页面能力', () => {
  it('逐页静态核对菜单、路由、列表动作、按钮权限和Java端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/employee-loan-amount.vue'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/employee-loan-amount/list.vue'), 'utf8')
    const javaDir = join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/employeeloanquota')
    const controller = readFileSync(join(javaDir, 'EmployeeLoanQuotaController.java'), 'utf8')
    const pageReq = readFileSync(join(javaDir, 'vo/EmployeeLoanQuotaPageReqVO.java'), 'utf8')
    const response = readFileSync(join(javaDir, 'vo/EmployeeLoanQuotaRespVO.java'), 'utf8')
    const excel = readFileSync(join(javaDir, 'vo/EmployeeLoanQuotaExcelVO.java'), 'utf8')
    const importResponse = readFileSync(join(javaDir, 'vo/EmployeeLoanQuotaImportRespVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/employeeloanquota/EmployeeLoanQuotaServiceImpl.java'), 'utf8')

    expect(menu).toContain(`path: '${FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/finance/setting/employee-loan-amount'")
    expect(route).toContain('permission: /dashboard/finance/setting/employee-loan-amount')
    expect(list).toContain("http.post('/admin-api/finance/employee-loan-quota/page', params)")
    expect(list).toContain("http.get('/admin-api/finance/employee-loan-quota/import-template'")
    expect(list).toContain("http.post('/admin-api/finance/employee-loan-quota/import'")
    expect(list).toContain("exportImport: 'finance:setting:employee-loan-amount:download-template'")
    expect(list).toContain("input.accept = '.xml,.xlsx,.xls'")
    expect(list).toContain('employeeName: null')
    expect(list).toContain('organizationIds: []')
    expect(list).toContain('type="employee_origin"')
    for (const column of ['employeeName', 'employeeNo', 'idCardNo', 'genderName', 'age', 'organizationName', 'position', 'employeeTypeName', 'loanQuota', 'debtAmount', 'availableQuota', 'quotaPeriod']) expect(list).toContain(`dataIndex: '${column}'`)
    expect(controller).toContain('@RequestMapping("/finance/employee-loan-quota")')
    expect(controller).toContain('@PostMapping("/page")')
    expect(controller).toContain('@PostMapping("/import")')
    expect(controller).toContain('@GetMapping("/import-template")')
    expect(pageReq).toContain('private String employeeName')
    expect(pageReq).toContain('private String phone')
    expect(pageReq).toContain('private List<Long> organizationIds')
    expect(pageReq).toContain('private List<Integer> employeeTypes')
    expect(response).toContain('private BigDecimal debtAmount')
    expect(response).toContain('private BigDecimal availableQuota')
    expect(excel).toContain('@ExcelProperty(value = "员工姓名", index = 0)')
    expect(excel).toContain('@ExcelProperty(value = "额度有效期结束日期", index = 11)')
    expect(importResponse).toContain('private Integer successCount')
    expect(importResponse).toContain('private List<ImportFailItem> failList')
    expect(service).toContain('employeeLoanQuotaMapper.delete')
    expect(service).toContain('employeeLoanQuotaMapper.insertBatch(successList)')
    expect(financeSettingEmployeeLoanAmountCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHODS))
    expect(financeSettingEmployeeLoanAmountCapabilities.every(item => item.pagePath === FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PAGE_PATH && item.permission === '/dashboard/finance/setting/employee-loan-amount' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingEmployeeLoanAmountCapabilities.find(item => item.id === 'finance-setting-employee-loan-amount-import')?.write).toBe(true)
  })

  it('默认分页请求逐字段复刻Portal表单、分页和POST端点', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/employee-loan-quota/page',
      method: 'post',
      data: {
        order: '',
        orderField: '',
        employeeName: null,
        phone: null,
        organizationIds: [],
        employeeTypes: [],
        pageNo: 1,
        pageSize: 20,
      },
    })
    const filtered = fixture([{ list: [], total: 0 }])
    await expect(filtered.api.list({ employeeName: '张', phone: '138', organizationIds: ['9007199254740995'], employeeTypes: [2], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(filtered.calls[0]?.data).toEqual({
      order: '', orderField: '', employeeName: '张', phone: '138', organizationIds: ['9007199254740995'], employeeTypes: [2], pageNo: 2, pageSize: 50,
    })
  })

  it('严格投影Portal可见列和Java计算字段，保留长ID与Decimal字符串', async () => {
    const hidden = { ...row, hiddenBackendField: 'not exposed' }
    const f = fixture([{ list: [hidden], total: 1 }])
    const result = await f.api.list()
    expect(result.list[0]).toEqual(row)
    expect(result.list[0]).not.toHaveProperty('hiddenBackendField')
    expect(result.list[0]?.id).toBe('9007199254740993')
    expect(result.list[0]?.organizationId).toBe('9007199254740995')
    expect(result.list[0]?.debtAmount).toBe('2000.00')
    expect(result.list[0]?.availableQuota).toBe('8000.00')
  })

  it('模板下载复刻blob二进制响应，导入复刻multipart file和结构化回执', async () => {
    const xlsx = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]).buffer
    const download = fixture([{ data: xlsx, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }])
    await expect(download.api.downloadTemplate()).resolves.toMatchObject({ fileName: '员工借款额度导入模板.xlsx', byteLength: 8, base64: Buffer.from(xlsx).toString('base64') })
    expect(download.calls[0]).toEqual({ url: '/admin-api/finance/employee-loan-quota/import-template', method: 'get', responseType: 'arraybuffer' })

    const input = { fileName: '员工借款额度.xlsx', base64: Buffer.from('xlsx').toString('base64') }
    const f = fixture([{ successCount: 1, failCount: 1, failList: [{ rowNum: 3, employeeName: '李四', idCardNo: 'bad', reason: '身份证号格式不正确' }] }])
    expect(f.api.prepareImport(input)).toEqual({ fileName: '员工借款额度.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 4 })
    await expect(f.api.importFile(input)).resolves.toEqual({ successCount: 1, failCount: 1, failList: [{ rowNum: 3, employeeName: '李四', idCardNo: 'bad', reason: '身份证号格式不正确' }] })
    expect(f.calls[0]?.url).toBe('/admin-api/finance/employee-loan-quota/import')
    expect(f.calls[0]?.method).toBe('post')
    expect(f.calls[0]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    expect(f.calls[0]?.data).toBeInstanceOf(FormData)
    expect((f.calls[0]?.data as FormData).get('file')).toBeInstanceOf(Blob)
  })

  it('导入边界、分页边界和坏响应必须反证为失败', async () => {
    const f = fixture()
    expect(() => f.api.prepareImport({ fileName: 'bad.csv', base64: 'AQID' })).toThrow('扩展名')
    expect(() => f.api.prepareImport({ fileName: '员工借款额度.xls', base64: '' })).toThrow('不能为空')
    await expect(f.api.list({ employeeTypes: [3 as never] })).rejects.toThrow('只能是1')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, quotaStartDate: 'bad' }], total: 1 }]).api.list()).rejects.toThrow('quotaStartDate')
    await expect(fixture([{ successCount: 1, failCount: 0, failList: null }]).api.importFile({ fileName: 'x.xlsx', base64: 'AQID' })).rejects.toThrow('failList')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.downloadTemplate()).rejects.toThrow('为空文件')
  })

  it('AI契约逐方法登记、描述返回和全量替换后续动作存在；破坏关键映射时断言失败', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: financeSettingEmployeeLoanAmountCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHODS).map(method => `financeSettingEmployeeLoanAmount.${method}`))
    expect(contracts['finance-setting-employee-loan-amount-list']?.output.fields.some(field => field.path === 'list[].availableQuota')).toBe(true)
    expect(contracts['finance-setting-employee-loan-amount-import']?.steps.some(step => step.role === 'cancel' && step.instruction.includes('没有cancel'))).toBe(true)
    const broken = structuredClone(contracts)
    const brokenField = broken['finance-setting-employee-loan-amount-import']!.output.fields.find(field => field.path === 'successCount')!
    brokenField.path = 'not a valid path'
    expect(validateAiContracts(broken, { definitions: financeSettingEmployeeLoanAmountCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
