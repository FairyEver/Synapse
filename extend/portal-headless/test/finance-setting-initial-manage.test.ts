import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  FINANCE_SETTING_INITIAL_MANAGE_METHODS,
  FINANCE_SETTING_INITIAL_MANAGE_MODULE_TYPE,
  FINANCE_SETTING_INITIAL_MANAGE_PAGE_PATH,
  FINANCE_SETTING_INITIAL_MANAGE_PERMISSION,
  financeSettingInitialManageCapabilities,
  createFinanceSettingInitialManageCapability,
} from '../src/capabilities/finance-setting-initial-manage.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingInitialManageCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const context = { accountingSetId: 7, periodMonth: '2026-09-18' }
const line = {
  id: 11,
  rowNo: 2,
  accountingSetCode: 'SJZ',
  accountingSetName: '石家庄',
  subjectType: '资产',
  subjectCode: '1002',
  subjectName: '银行存款',
  endingDebitAmount: 12.5,
  endingCreditAmount: '1.50',
  endingQuantity: null,
  matchStatus: 2,
  errorMessage: '差异',
}

describe('Portal 系统设置 → 期初设置页面能力', () => {
  it('逐页锁定入口、权限、页签、条件筛选和所有可达动作', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    expect(FINANCE_SETTING_INITIAL_MANAGE_PAGE_PATH).toBe('/dashboard/finance/setting/initial-manage/list')
    expect(FINANCE_SETTING_INITIAL_MANAGE_PERMISSION).toBe('/dashboard/finance/setting/initial-manage')
    expect(FINANCE_SETTING_INITIAL_MANAGE_MODULE_TYPE).toBeNull()
    expect(Object.keys(FINANCE_SETTING_INITIAL_MANAGE_METHODS)).toContain('finance-setting-initial-manage-list')
    const menu = read(portal, 'app/portal/menus/finance.js')
    const entry = read(portal, 'app/portal/views/dashboard/finance/setting/initial-manage/list.vue')
    const list = read(portal, 'app/portal/views/dashboard/finance/setting/components/opening-setting-list.vue')
    const config = read(portal, 'app/portal/views/dashboard/finance/setting/components/opening-setting-config.js')
    const hiddenEdit = read(portal, 'app/portal/views/dashboard/finance/setting/initial-manage/[mode]/[id].vue')
    expect(menu).toContain("path: '/dashboard/finance/setting/initial-manage/list'")
    expect(menu).toContain("permission: '/dashboard/finance/setting/initial-manage'")
    expect(entry).toContain('<opening-setting-list/>')
    for (const fragment of [
      'accountingSetId', 'periodMonth', 'subjectCode', 'supplierCode', 'customerCode', 'orderNo', 'batchNo',
      'materialCode', 'materialName', 'bankAccountCode', 'bankAccountName',
      '/admin-api/finance/opening-setting/tabs', '/admin-api/finance/opening-setting/status',
      '/admin-api/finance/opening-setting/import-template', '/admin-api/finance/opening-setting/import-excel',
      '/admin-api/finance/opening-setting/trial-balance', '/admin-api/finance/opening-setting/manual-match',
      '/admin-api/finance/opening-setting/delete-lines', '/admin-api/finance/opening-setting/reconcile',
      '/admin-api/finance/opening-setting/post-to-ledger', '/admin-api/finance/opening-setting/reconcile-result/page',
      '/admin-api/finance/opening-setting/operation-log/page', 'finance:setting:opening-setting:import',
      'finance:setting:opening-setting:trial', 'finance:setting:opening-setting:reconcile', '20 * 1024 * 1024',
    ]) expect(list).toContain(fragment)
    for (const fragment of ['openingBalance', 'accumulatedDebit', 'accumulatedCredit', 'beginningBalance', '/admin-api/finance/initial-manage/update', 'http.put']) expect(hiddenEdit).toContain(fragment)
    for (const fragment of ['SUBJECT', 'SUPPLIER', 'CUSTOMER', 'BIO_LAYING_HEN', 'BIO_GROWING_CHICKEN', 'BANK_STATEMENT', 'summaryRows']) expect(config + list).toContain(fragment)
    expect(financeSettingInitialManageCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_INITIAL_MANAGE_METHODS))
    expect(financeSettingInitialManageCapabilities.every(item => item.pagePath === FINANCE_SETTING_INITIAL_MANAGE_PAGE_PATH && item.permission === FINANCE_SETTING_INITIAL_MANAGE_PERMISSION && item.moduleType === FINANCE_SETTING_INITIAL_MANAGE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定Java控制器和VO字段，避免把旧接口或后端扩展字段误当页面能力', () => {
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const base = 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/openingsetting'
    const controller = read(java, `${base}/OpeningSettingController.java`)
    const legacyController = read(java, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/initialmanage/InitialManageController.java')
    const legacySave = read(java, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/initialmanage/vo/InitialManageSaveReqVO.java')
    const subjectReq = read(java, `${base}/vo/OpeningSubjectLinePageReqVO.java`)
    const subjectResp = read(java, `${base}/vo/OpeningSubjectLineRespVO.java`)
    const status = read(java, `${base}/vo/OpeningStatusRespVO.java`)
    const tabStatus = read(java, `${base}/vo/OpeningTabStatusRespVO.java`)
    const importResp = read(java, `${base}/vo/OpeningImportRespVO.java`)
    const deleteReq = read(java, `${base}/vo/OpeningDeleteLinesReqVO.java`)
    const manualReq = read(java, `${base}/vo/OpeningManualMatchReqVO.java`)
    const resultReq = read(java, `${base}/vo/OpeningReconcileResultPageReqVO.java`)
    for (const fragment of ['@RequestMapping("/finance/opening-setting")', '@GetMapping("/tabs")', '@GetMapping("/status")', '@PostMapping("/delete-lines")', '@PostMapping("/subject/page")', '@PostMapping("/supplier/page")', '@PostMapping("/customer/page")', '@PostMapping("/bio-laying-hen/page")', '@PostMapping("/bio-growing-chicken/page")', '@PostMapping("/bank-statement/page")', '@GetMapping("/import-template")', '@PostMapping("/import-excel")', '@PostMapping("/trial-balance")', '@PostMapping("/reconcile")', '@PostMapping("/manual-match")', '@PostMapping("/post-to-ledger")', '@PostMapping("/reconcile-result/page")', '@PostMapping("/operation-log/page")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long accountingSetId', 'private LocalDate periodMonth', 'private String subjectCode', 'private Long id', 'private Integer rowNo', 'private BigDecimal endingDebitAmount', 'private Integer matchStatus']) expect(subjectReq + subjectResp).toContain(fragment)
    for (const fragment of ['private Boolean locked', 'private String disabledReason', 'private List<OpeningTabStatusRespVO> tabs', 'private Long batchId', 'private Integer rowCount', 'private Integer trialStatus', 'private Integer reconcileStatus']) expect(status + tabStatus).toContain(fragment)
    for (const fragment of ['private Boolean success', 'private Integer successCount', 'private Integer failCount', 'private List<OpeningImportErrorVO> errors', '@Size(max = 1000', 'private Set<@NotNull']) expect(importResp + deleteReq + manualReq).toContain(fragment)
    for (const fragment of ['private String moduleCode', 'private String subjectCode', 'private Integer matchStatus']) expect(resultReq).toContain(fragment)
    expect(legacyController).toContain('@RequestMapping("/finance/initial-manage")')
    expect(legacyController).toContain('@PutMapping("/update")')
    for (const fragment of ['private Long id', 'private String openingBalance', 'private String accumulatedDebit', 'private String accumulatedCredit', 'private String beginningBalance']) expect(legacySave).toContain(fragment)
  })

  it('隐藏编辑严格按prepare→submit，保持完整表单字段和PUT body', async () => {
    const form = {
      id: 17,
      accountingName: '石家庄',
      openingBalance: '100.00',
      accumulatedDebit: null,
      accumulatedCredit: '20.00',
      beginningBalance: '80.00',
    }
    const f = fixture([undefined])
    const prepared = f.api.prepareUpdate({ form }).draft
    expect(prepared).toEqual(form)
    expect(f.calls).toHaveLength(0)
    await expect(f.api.update({ draft: prepared })).resolves.toBeUndefined()
    expect(f.calls).toEqual([{ url: '/admin-api/finance/initial-manage/update', method: 'put', data: form }])
    expect(f.api.cancelUpdate()).toEqual({ cancelled: true })
    expect(() => f.api.prepareUpdate({ form: { ...form, openingBalance: '100元' } })).toThrow('非法字符')
    expect(f.calls).toHaveLength(1)
  })

  it('按Portal当前页签生成精确分页请求，并保留生物资产汇总', async () => {
    const bioSummary = { id: null, rowType: 'TOTAL', summaryLabel: '合计', summaryField: null, summaryValues: { openingOriginalValue: '10.00' } }
    const f = fixture([
      [{ code: 'SUBJECT', name: '科目期初数据', sort: 1 }],
      { ...context, periodMonth: '2026-09-01', sourcePeriodMonth: '2026-08-01', locked: false, disabledReason: null, tabs: [] },
      { list: [line], total: 1 },
      { list: [line], total: 1, summary: bioSummary, summaryRows: [bioSummary] },
    ])
    await expect(f.api.listTabs()).resolves.toEqual([{ code: 'SUBJECT', name: '科目期初数据', sort: 1 }])
    await expect(f.api.getStatus(context)).resolves.toMatchObject({ accountingSetId: 7, periodMonth: '2026-09-01', locked: false })
    await expect(f.api.list({ ...context, tabType: 'SUBJECT', subjectCode: '1002' })).resolves.toMatchObject({ total: 1, list: [{ subjectCode: '1002', endingDebitAmount: 12.5 }] })
    await expect(f.api.list({ ...context, tabType: 'BIO_LAYING_HEN', orderNo: 'MO1', supplierName: 'must-not-send' })).resolves.toMatchObject({ summaryRows: [{ rowType: 'TOTAL' }] })
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/opening-setting/tabs', method: 'get' },
      { url: '/admin-api/finance/opening-setting/status', method: 'get', params: { accountingSetId: 7, periodMonth: '2026-09-01' } },
      { url: '/admin-api/finance/opening-setting/subject/page', method: 'post', data: { accountingSetId: 7, periodMonth: '2026-09-01', pageNo: 1, pageSize: 50, subjectCode: '1002' } },
      { url: '/admin-api/finance/opening-setting/bio-laying-hen/page', method: 'post', data: { accountingSetId: 7, periodMonth: '2026-09-01', pageNo: 1, pageSize: 50, orderNo: 'MO1' } },
    ])
  })

  it('离线契约覆盖prepare → submit映射、文件边界、结果分页、日志和本地导出', async () => {
    const fileResponse = { data: new TextEncoder().encode('template').buffer, headers: { 'content-type': 'application/vnd.ms-excel' } }
    const f = fixture([
      fileResponse,
      { batchId: 9, success: true, successCount: 1, failCount: 0, errors: [], periodResults: [] },
      { balanced: true, totalDebitAmount: 10, totalCreditAmount: 10, asset: 10, cost: null, equity: null, liability: null, profitLoss: null, assetCostTotal: 10, equityLiabilityProfitLossTotal: 10, differenceAmount: 0, message: '平衡' },
      { reconcileNo: 'QC1', matched: false, resultCount: 1 },
      { updatedCount: 1, allMatchedOrIgnored: true, remainingCount: 0 },
      { batchId: 9, deletedCount: 1, rowCount: 0 },
      { posted: true, subjectCount: 1, customerCount: 0, supplierCount: 0, bankAccountCount: 0 },
      { list: [{ id: 21, moduleCode: 'SUPPLIER', moduleName: '供应商', subjectCode: '2202', subjectName: '应付', sourceSystem: '外部', matchStatus: 2, sourceAmount: 10, financeAmount: 9, differenceAmount: 1, sourceQuantity: null, financeQuantity: null, differenceQuantity: null, detailJson: null }], total: 1 },
      { list: [{ id: 21, moduleCode: 'SUPPLIER', moduleName: '供应商', subjectCode: '2202', subjectName: '应付', sourceSystem: '外部', matchStatus: 2, sourceAmount: 10, financeAmount: 9, differenceAmount: 1, sourceQuantity: null, financeQuantity: null, differenceQuantity: null, detailJson: null }], total: 1 },
      { list: [{ id: 31, tabType: 'SUBJECT', operationType: 'DELETE_LINES', operationStatus: 1, operatorId: 4, operatorName: '李四', startTime: '2026-09-25T10:00:00', endTime: '2026-09-25T10:00:01', failureDetailJson: null, remark: null }], total: 1 },
    ])
    const preview = f.api.prepareImport({ fileName: '期初.xlsx', base64: Buffer.from('file').toString('base64') })
    expect(preview).toMatchObject({ fileName: '期初.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 4 })
    await expect(f.api.downloadTemplate({ ...context, tabType: 'SUBJECT' })).resolves.toMatchObject({ fileName: '科目期初数据导入模板.xlsx', byteLength: 8 })
    await expect(f.api.importFile({ ...context, tabType: 'SUBJECT', fileName: '期初.xlsx', base64: Buffer.from('file').toString('base64') })).resolves.toMatchObject({ success: true, batchId: 9 })
    const trialDraft = f.api.prepareTrialBalance(context).draft
    await expect(f.api.trialBalance({ draft: trialDraft })).resolves.toMatchObject({ balanced: true, differenceAmount: 0 })
    const reconcileDraft = f.api.prepareReconcile(context).draft
    await expect(f.api.reconcile({ draft: reconcileDraft })).resolves.toMatchObject({ reconcileNo: 'QC1', matched: false })
    const manualDraft = f.api.prepareManualMatch({ ...context, tabType: 'SUPPLIER', lineIds: [11] }).draft
    await expect(f.api.manualMatch({ draft: manualDraft })).resolves.toMatchObject({ updatedCount: 1, remainingCount: 0 })
    const deleteDraft = f.api.prepareDeleteLines({ ...context, tabType: 'SUPPLIER', batchId: 9, lineIds: [11] }).draft
    await expect(f.api.deleteLines({ draft: deleteDraft })).resolves.toMatchObject({ deletedCount: 1, rowCount: 0 })
    await expect(f.api.postToLedger({ draft: f.api.preparePostToLedger(context).draft })).resolves.toMatchObject({ posted: true, subjectCount: 1 })
    await expect(f.api.listReconcileResults({ ...context })).resolves.toMatchObject({ total: 1, list: [{ matchStatus: 2 }] })
    await expect(f.api.exportReconcileResults(context)).resolves.toMatchObject({ fileName: '对账结果.xls', contentType: 'application/vnd.ms-excel' })
    await expect(f.api.listOperationLogs({ ...context })).resolves.toMatchObject({ total: 1, list: [{ operationType: 'DELETE_LINES' }] })
    const importCall = f.calls.find(call => call.url?.endsWith('/import-excel'))
    expect(importCall).toMatchObject({ method: 'post', params: { tabType: 'SUBJECT', accountingSetId: 7, periodMonth: '2026-09-01' }, headers: { 'Content-Type': 'multipart/form-data' } })
    expect(f.calls.filter(call => call.url?.includes('/reconcile-result/page'))).toHaveLength(2)
    expect(f.calls.at(-1)).toMatchObject({ url: '/admin-api/finance/opening-setting/operation-log/page', method: 'post', data: { accountingSetId: 7, periodMonth: '2026-09-01', pageNo: 1, pageSize: 50 } })
  })

  it('坏月份、错误页签、非法文件、超限ID和错误分页会在请求前失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ ...context, tabType: 'SUBJECT', periodMonth: '2026-02-30' })).rejects.toThrow('不是有效日期')
    await expect(f.api.list({ ...context, tabType: 'SUBJECT', pageSize: 500 })).rejects.toThrow('pageSize')
    expect(() => f.api.prepareImport({ fileName: '期初.csv', base64: 'ZmlsZQ==' })).toThrow('扩展名')
    expect(() => f.api.prepareImport({ fileName: '期初.xlsx', base64: 'not-base64' })).toThrow('Base64')
    expect(() => f.api.prepareManualMatch({ ...context, tabType: 'SUBJECT', lineIds: [] })).toThrow('非空')
    expect(() => f.api.prepareManualMatch({ ...context, tabType: 'SUBJECT', lineIds: Array.from({ length: 1001 }, (_, index) => index + 1) })).toThrow('1000')
    expect(f.calls).toHaveLength(0)
  })
})
