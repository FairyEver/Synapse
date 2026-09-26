import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createReportInsurancePaymentSummaryCapability, REPORT_INSURANCE_PAYMENT_SUMMARY_METHODS, REPORT_INSURANCE_PAYMENT_SUMMARY_PAGE_PATH, reportInsurancePaymentSummaryCapabilities } from '../src/capabilities/report-insurance-payment-summary.js'
import { REPORT_INSURANCE_PAYMENT_SUMMARY_AI_CONTRACTS as contracts, REPORT_INSURANCE_PAYMENT_SUMMARY_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-report-insurance-payment-summary.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) { const calls: RequestConfig[] = []; const request: PortalRequest = async <T>(config: RequestConfig) => { calls.push(config); const next = responses.shift(); if (next instanceof Error) throw next; return next as T }; return { api: createReportInsurancePaymentSummaryCapability(request), calls } }
const summary = { id: 101, socialFundSummaryIds: [101], organizationId: 9, organizationName: '总部-财务', staffCount: 2, useYearMonth: '2026-09', pensionCompany: '100.00', pensionPersonal: '80.00', unemploymentCompany: '10.00', unemploymentPersonal: '5.00', injuryCompany: '2.00', injuryPersonal: '0.00', medicalCompany: '30.00', medicalPersonal: '20.00', majorMedicalPersonal: '3.00', totalCompany: '142.00', totalPersonal: '108.00', totalAmount: '250.00', status: 0 }
const person = { name: '张三', useYearMonth: '2026-09', pensionCompany: '50.00', pensionPersonal: '40.00', unemploymentCompany: '5.00', unemploymentPersonal: '2.00', injuryCompany: '1.00', injuryPersonal: '0.00', medicalCompany: '15.00', medicalPersonal: '10.00', majorMedicalPersonal: '1.00', totalCompany: '71.00', totalPersonal: '53.00', status: 0 }
const task = { id: 'Activity_1', name: '发起人自选' }

describe('Portal 人力报表 → 社保缴纳汇总表及缴纳单', () => {
  it('锁定菜单、权限、platform实例、module-type和Portal/Java端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/insurance-payment-summary/list.vue'), 'utf8')
    const modal = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/insurance-payment-summary/ModalContentForDetail.vue'), 'utf8')
    const form = readFileSync(join(portalRoot, 'app/portal/views/simple/hr/form/018/page/pc/edit/index.vue'), 'utf8')
    const reportController = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryInsuranceCostsController.java'), 'utf8')
    const paymentController = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/socialfundpayment/SocialFundPaymentController.java'), 'utf8')
    const createVo = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/socialfundpayment/vo/SocialFundPaymentCreateVO.java'), 'utf8')
    expect(menu).toContain(`path: '${REPORT_INSURANCE_PAYMENT_SUMMARY_PAGE_PATH}'`)
    expect(page).toContain("getDataListURL: '/salary/salaryinsurancecosts/paymentSummaryPage'")
    expect(page).toContain("path: 'simple/hr/form/018'")
    expect(page).toContain('ModalContentForDetail')
    expect(modal).toContain("/salary/salaryinsurancecosts/paymentSummaryDetailPage")
    expect(form).toContain("bpmProcessDefineKey: 'social_security_payment'")
    expect(form).toContain("const apiCheck = '/admin-api/hr/social-fund-payment/getRequiredStartUserSelectTasks'")
    expect(form).toContain("http.post('/admin-api/hr/social-fund-payment/create'")
    expect(reportController).toContain('@RequestMapping("/salary/salaryinsurancecosts")')
    expect(reportController).toContain('@GetMapping("paymentSummaryPage")')
    expect(reportController).toContain('@GetMapping("paymentSummaryDetailPage")')
    expect(paymentController).toContain('@PostMapping("/create")')
    expect(paymentController).toContain('@PostMapping("/getRequiredStartUserSelectTasks")')
    expect(paymentController).toContain('@PostMapping("/cancel")')
    for (const field of ['useYearMonth', 'paymentDate', 'organizationId', 'depositUnitIds', 'type', 'socialFundSummaryVOList', 'budgetAllocations', 'startUserSelectAssignees']) expect(createVo).toContain(field)
    expect(reportInsurancePaymentSummaryCapabilities.every(item => item.pagePath === REPORT_INSURANCE_PAYMENT_SUMMARY_PAGE_PATH && item.permission === '/dashboard/report/insurance-payment-summary' && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(REPORT_INSURANCE_PAYMENT_SUMMARY_PAGE_PATH).moduleType).toBe(14)
  })

  it('列表和人员明细逐字段复现Portal的日期、组织、排序和分页参数', async () => {
    const f = fixture([{ list: [summary], total: 1 }, { title: '总部-财务（2026-09）', page: { list: [person], total: 1 } }])
    await expect(f.api.list({ orgIds: [9, '10'], costDateRange: ['2026-09', '2026-10'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [summary], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/salary/salaryinsurancecosts/paymentSummaryPage', method: 'get', params: { order: '', orderField: '', costDateStart: '2026-09-01', costDateEnd: '2026-10-01', orgIds: '9,10', pageNo: 2, pageSize: 50 } })
    await expect(f.api.personDetail({ summaryIds: [101, 102], depositUnitIds: [7], name: '张', pageNo: 2, pageSize: 20 })).resolves.toEqual({ title: '总部-财务（2026-09）', page: { list: [person], total: 1 } })
    expect(f.calls[1]).toEqual({ url: '/salary/salaryinsurancecosts/paymentSummaryDetailPage', method: 'get', params: { order: '', orderField: '', summaryIds: '101,102', depositUnitIds: '7', name: '张', pageNo: 2, pageSize: 20 } })
  })

  it('社保表单严格复现金额明细、缴存单位聚合、预算和审批节点提交链路', async () => {
    const f = fixture([[task], [task], 9001, { id: 9001, type: 1, totalAmount: '250.00', status: 1 }])
    const draft = { useYearMonth: '2026-09', paymentDate: '2026-09-30', name: 'SDK-TEST-社保', organizationId: 9, organizationName: '总部-财务', depositUnitIds: [7], socialFundSummaryVOList: [{ ...summary, amount: '250.00', socialFundSummaryId: 101, socialFundSummaryIds: [101, 102], depositUnitIds: [7], depositUnitNames: ['法人'] }], budgetAllocationsNo: 'B-1', businessContent: '社保', budgetAllocations: [{ budgetDetailNo: 'B-1', budgetDetailId: 88 }] }
    await expect(f.api.prepare(draft)).resolves.toMatchObject({ payload: { useYearMonth: '2026-09', paymentDate: '2026-09-30', organizationId: 9, organizationName: '总部-财务', depositUnitIds: [7], type: 1, totalAmount: 250, budgetAllocations: [{ budgetDetailNo: 'B-1', budgetDetailId: 88 }] }, tasks: [task] })
    expect(f.calls[0]).toEqual({ url: '/hr/social-fund-payment/getRequiredStartUserSelectTasks', method: 'post', data: expect.objectContaining({ type: 1, totalAmount: 250, socialFundSummaryVOList: [expect.objectContaining({ socialFundSummaryIds: [101, 102], amount: 250 })] }) })
    await expect(f.api.submit(draft, { Activity_1: [77] })).resolves.toBe(9001)
    expect(f.calls[1]).toEqual({ url: '/hr/social-fund-payment/getRequiredStartUserSelectTasks', method: 'post', data: expect.any(Object) })
    expect(f.calls[2]).toEqual({ url: '/hr/social-fund-payment/create', method: 'post', data: expect.objectContaining({ type: 1, startUserSelectAssignees: { Activity_1: [77] } }) })
    await expect(f.api.paymentDetail(9001)).resolves.toEqual({ id: 9001, type: 1, totalAmount: '250.00', status: 1 })
    expect(f.calls[3]).toEqual({ url: '/hr/social-fund-payment/get', method: 'get', params: { id: 9001 } })
  })

  it('未选择缴存单位时只保留单个汇总ID，按个人和单位合计计算金额，坏参数和审批映射会在请求前失败', async () => {
    const f = fixture([[]])
    const draft = { useYearMonth: '2026-09', paymentDate: '2026-09-30', organizationId: 9, organizationName: '总部', socialFundSummaryVOList: [{ socialFundSummaryId: 101, socialFundSummaryIds: [101], totalPersonal: 40, totalCompany: 50 }] }
    await expect(f.api.prepare(draft)).resolves.toMatchObject({ payload: { totalAmount: 90, socialFundSummaryVOList: [expect.objectContaining({ socialFundSummaryId: 101, amount: 90 })] }, tasks: [] })
    await expect(f.api.list({ costDateRange: ['2026-13', '2026-10'] as never })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(f.api.prepare({ ...draft, socialFundSummaryVOList: [] })).rejects.toThrow('不能为空')
    await expect(fixture([[task]]).api.submit(draft, { Activity_1: [1], unknown: [1] })).rejects.toThrow('未知节点')
    await expect(f.api.paymentDetail(0)).rejects.toThrow('id')
  })

  it('AI契约覆盖列表、保险明细和prepare→submit→回查步骤', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_INSURANCE_PAYMENT_SUMMARY_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(REPORT_INSURANCE_PAYMENT_SUMMARY_METHODS).map(method => `reportInsurancePaymentSummary.${method}`))])
    expect(contracts['report-insurance-payment-summary-list']?.output.fields.some(item => item.path === 'list[].pensionCompany')).toBe(true)
    expect(contracts['report-insurance-payment-summary-list']?.output.fields.some(item => item.path === 'list[].majorMedicalPersonal')).toBe(true)
    expect(contracts['report-insurance-payment-summary-submit']?.steps.some(step => step.capabilityId === 'report-insurance-payment-summary-payment-detail')).toBe(true)
    expect(contracts['report-insurance-payment-summary-submit']?.inputs.draft?.meaning).toContain('socialFundSummaryVOList')
  })
})
