import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingVoucherTemplatesCapability,
  financeSettingVoucherTemplatesCapabilities,
  FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS,
  FINANCE_SETTING_VOUCHER_TEMPLATES_PAGE_PATH,
  type FinanceVoucherTemplateCreateDraft,
  type FinanceVoucherTemplateRow,
} from '../src/capabilities/finance-setting-voucher-templates.js'
import {
  FINANCE_SETTING_VOUCHER_TEMPLATES_AI_CONTRACTS as contracts,
  FINANCE_SETTING_VOUCHER_TEMPLATES_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-voucher-templates.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceVoucherTemplateRow = {
  id: '9007199254740993', name: '销售收入模板', businessType: 'voucher_income', businessDetail: '1',
  createTime: '2026-09-23 09:00:00', updateTime: '2026-09-23 09:01:00', status: 0,
}

const entry = {
  borrowList: [{ subjectId: '11', subjectFullPath: '资产/银行', subjectAmount: ['orderTotal'], addInfo: ['aux'], cashItemList: [2], type: 1 as const }],
  lendList: [{ subjectId: 12, subjectAmount: ['orderTotal', 2], addInfo: [], cashItemList: [], type: 2 as const }],
  summary: '销售收入确认', summaryId: '22', accountingSetType: 1,
}

const draft: FinanceVoucherTemplateCreateDraft = {
  name: '销售收入模板', businessType: 'voucher_income', businessDetail: '1', entry: [entry],
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingVoucherTemplatesCapability(request), calls }
}

describe('财务设置→凭证模板页面能力', () => {
  it('静态锁定菜单、权限、页面请求和Java端点', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/voucher-templates.vue'), 'utf8')
    const list = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/voucher-templates/list.vue'), 'utf8')
    const form = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/voucher-templates/[mode]/[id].vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/voucher/vouchertemplate/VoucherTemplateController.java'), 'utf8')
    const amountController = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/voucher/voucheramountoptionconfig/VoucherAmountOptionConfigController.java'), 'utf8')

    expect(menu).toContain("path: '" + FINANCE_SETTING_VOUCHER_TEMPLATES_PAGE_PATH + "'")
    expect(menu).toContain("permission: '/dashboard/finance/setting/voucher-templates'")
    expect(route).toContain('permission: /dashboard/finance/setting/voucher-templates')
    expect(list).toContain("getDataListURL: '/admin-api/finance/voucher-template/page'")
    expect(list).toContain("finance:setting:voucher-templates:status")
    expect(list).toContain("http.put('/admin-api/finance/voucher-template/update'")
    expect(list).toContain("/admin-api/finance/voucher-template/export-excel")
    expect(form).toContain("http.get('/admin-api/finance/voucher-amount-option/list'")
    expect(form).toContain("http.post('/admin-api/finance/voucher-template/create'")
    expect(form).toContain('entrySaveReqVOList')
    expect(controller).toContain('@RequestMapping("/finance/voucher-template")')
    expect(controller).toContain('@PostMapping("/create")')
    expect(controller).toContain('@PutMapping("/update")')
    expect(amountController).toContain('@RequestMapping("/finance/voucher-amount-option")')
    expect(financeSettingVoucherTemplatesCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS))
    expect(financeSettingVoucherTemplatesCapabilities.every(item => item.permission === '/dashboard/finance/setting/voucher-templates' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
  })

  it('默认列表复现遗留筛选字段、状态和分页，并投影页面行', async () => {
    const f = fixture([{ list: [{ ...row, ignored: 'x' }], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/voucher-template/page', method: 'get',
      params: { order: '', orderField: '', name: '', businessType: '', businessDetail: '', orgAttributes: '', cashItem: '', status: 0, pageNo: 1, pageSize: 20 },
    })
  })

  it('金额选项、详情和预览分别复现支撑请求与本地桥接', async () => {
    const detail = { ...row, income: { isCreditUsed: 1 }, entry: [{ summary: '摘要' }] }
    const f = fixture([[{ amountCode: 'orderTotal', amountLabel: '订单总额', sort: 1 }], detail])
    await expect(f.api.amountOptions({ businessType: 'voucher_income', businessDetail: '1' })).resolves.toEqual([{ amountCode: 'orderTotal', amountLabel: '订单总额', sort: 1 }])
    await expect(f.api.get({ id: row.id })).resolves.toEqual(detail)
    expect(f.api.preview({ record: row })).toEqual(row)
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/voucher-amount-option/list', method: 'get', params: { businessType: 'voucher_income', businessDetail: '1' } },
      { url: '/admin-api/finance/voucher-template/get', method: 'get', params: { id: row.id } },
    ])
  })

  it('创建复现页面默认详情、分录借贷顺序和join转换', async () => {
    const f = fixture(['9007199254740997'])
    const prepared = f.api.prepareCreate(draft).draft
    expect(prepared).toMatchObject({ name: draft.name, businessType: draft.businessType, businessDetail: draft.businessDetail, status: 0 })
    expect(prepared.outlay).toMatchObject({ useMethod: '', isIncludeTax: '', energyType: '' })
    expect(prepared.entry).toEqual([{
      summary: '销售收入确认', summaryId: '22', accountingSetType: 1,
      entrySaveReqVOList: [
        { subjectId: '11', subjectAmount: 'orderTotal', addInfo: 'aux', cashItemList: [2], type: 1 },
        { subjectId: 12, subjectAmount: 'orderTotal,2', addInfo: '', cashItemList: [], type: 2 },
      ],
    }])
    await expect(f.api.create(draft)).resolves.toBe('9007199254740997')
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/voucher-template/create', method: 'post', data: prepared })
    expect(() => f.api.prepareCreate({ ...draft, name: 'x'.repeat(101) })).toThrow('100')
    expect(() => f.api.prepareCreate({ ...draft, entry: [{ ...entry, borrowList: [] }] })).toThrow('借方')
    expect(() => f.api.prepareCreate({ ...draft, entry: [{ ...entry, lendList: [{ ...entry.lendList[0]!, type: 1 as const }] }] })).toThrow('借贷')
    expect(() => f.api.prepareCreate({ ...draft, entry: [{ ...entry, borrowList: [{ ...entry.borrowList[0]!, subjectAmount: [] }] }] })).toThrow('subjectAmount')
  })

  it('状态按钮按Portal整行PUT，不伪造单独status接口，并保留previous', async () => {
    const f = fixture([true, true])
    const prepared = f.api.prepareSetStatus({ current: row, targetStatus: 1 })
    expect(prepared).toEqual({ draft: { ...row, status: 1 }, previous: row })
    await expect(f.api.setStatus({ draft: prepared.draft })).resolves.toBe(true)
    await expect(f.api.setStatus({ draft: prepared.previous })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/voucher-template/update', method: 'put', data: { ...row, status: 1 } },
      { url: '/admin-api/finance/voucher-template/update', method: 'put', data: row },
    ])
    expect(() => f.api.prepareSetStatus({ current: row, targetStatus: 0 })).toThrow('相反')
  })

  it('导出去掉分页并返回Java文件名和非空二进制', async () => {
    const response = { data: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer, headers: { 'content-type': 'application/vnd.ms-excel' } } as AxiosResponse<ArrayBuffer>
    const f = fixture([response])
    await expect(f.api.exportExcel({ name: '收入', status: 1, pageNo: 2, pageSize: 50 })).resolves.toEqual({
      fileName: '凭证模版基础信息.xls', contentType: 'application/vnd.ms-excel', base64: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString('base64'), byteLength: 4,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/voucher-template/export-excel', method: 'get',
      params: { name: '收入', businessType: '', businessDetail: '', orgAttributes: '', cashItem: '', status: 1 }, responseType: 'arraybuffer',
    })
  })

  it('坏响应、权限边界和AI契约反证不会静默成功', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ ...row, id: 0 }]).api.get({ id: 1 })).rejects.toThrow('凭证模板详情')
    await expect(fixture([{ amountCode: 'x' }]).api.amountOptions({ businessType: 'voucher_income' })).rejects.toThrow('数组')
    await expect(fixture([false]).api.setStatus({ draft: row })).rejects.toThrow('不是true')
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS).map(method => `financeSettingVoucherTemplates.${method}`))
    expect(contracts['finance-setting-voucher-templates-prepare-create']?.steps.some(step => step.mapping?.entry === 'result.draft.entry')).toBe(true)
    expect(contracts['finance-setting-voucher-templates-set-status']?.boundaries.join('\n')).toContain('整行')
  })
})
