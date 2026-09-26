import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductBusinessDataRetransmitCapability,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_METHODS,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_MODULE_TYPE,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_SAP_UPLOAD_TYPES,
  productBusinessDataRetransmitCapabilities,
} from '../src/capabilities/product-business-data-retransmit.js'
import { PRODUCT_BUSINESS_DATA_RETRANSMIT_AI_CONTRACTS as contracts, PRODUCT_BUSINESS_DATA_RETRANSMIT_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-business-data-retransmit.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductBusinessDataRetransmitCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Portal 生产设置 → 业务管理 → 种摊数据重传', () => {
  it('逐tab锁定菜单、product实例、表单和Java调用边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const page = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/data-retransmit/list.vue')
    const upload = read(portalRoot, 'app/portal/views/dashboard/product/components/data-retransmit-upload/list.vue')
    const query = read(portalRoot, 'app/portal/views/dashboard/product/components/data-retransmit-query/list.vue')
    const finance = read(portalRoot, 'app/portal/views/dashboard/product/components/data-retransmit-finance/list.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/flockamortization/DataRetransmitController.java')
    const financeController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/financesync/FinanceRetransmitController.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/flockamortization/vo/DataRetransmitVO.java')
    expect(menu).toContain(`path: '${PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION}'`)
    for (const fragment of [
      'DataRetransmitUpload', 'DataRetransmitQuery', 'DataRetransmitFinance',
      "'1': markRaw(DataRetransmitUpload)", "'2': markRaw(DataRetransmitQuery)", "'3': markRaw(DataRetransmitFinance)",
    ]) expect(page).toContain(fragment)
    for (const fragment of ["import { http } from 'app/portal/utils/http/product.js'", "url: '/base/dataRetransmit/submit'", 'yearMonth', 'farm', 'required: true', 'type: 12']) expect(upload).toContain(fragment)
    for (const fragment of ["url: '/base/dataRetransmit/list'", 'amortizationData', 'layerDeathsAndEliminateItemList', 'layerTransferList', 'transferList', 'typeOptions']) expect(query).toContain(fragment)
    for (const fragment of ["url: '/base/financeRetransmit/uploadAllByDateAndType'", 'submitAll', 'for (const option of syncOptions)', 'if (formState.farm)', 'yearMonth']) expect(finance).toContain(fragment)
    for (const fragment of ['@RequestMapping("flockSimu/base/dataRetransmit")', '@PostMapping("/submit")', '@GetMapping("/list")', '@RepeatSubmitLimit', '@RequestMapping("flockSimu/base/financeRetransmit")', '@GetMapping("/uploadAllByDateAndType")', 'private String yearMonth']) expect(controller + financeController + vo).toContain(fragment)
  })

  it('SAP重传严格复刻月份、场区、类型和POST提交体', async () => {
    const f = fixture([{}])
    const prepared = f.api.prepareSapUpload({ type: 3, yearMonth: '2026-08', farm: 'farm-1' })
    expect(prepared).toEqual({ draft: { type: 3, yearMonth: '2026-08', farm: 'farm-1' } })
    await expect(f.api.submitSapUpload(prepared)).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/base/dataRetransmit/submit', method: 'post', data: { type: 3, yearMonth: '2026-08', farm: 'farm-1' } }])
    expect(PRODUCT_BUSINESS_DATA_RETRANSMIT_SAP_UPLOAD_TYPES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('SAP查询复刻Portal行展开、分页参数和嵌套明细', async () => {
    const source = {
      id: 'row-1',
      farmName: '一场',
      month: '2026-08',
      ignoredTopLevel: 'not rendered',
      amortizationData: {
        sapOrder: 'SAP-1',
        closingQty: 100,
        layerDeathsAndEliminateItemList: [{ type: '03', deathDate: '2026-08-10', total: 2 }],
        transferList: [{ type: '转入', total: 10, batch: 'B-2', order: 'O-2', transferDate: '2026-08-11' }],
      },
    }
    const f = fixture([{ list: [source], total: 5 }])
    await expect(f.api.listSap({ type: 121, farm: 'farm-1', yearMonth: '2026-08', pageNo: 2, pageSize: 50 })).resolves.toEqual({
      list: [{ id: 'row-1', farmName: '一场', yearAndMonth: '2026-08', sapOrder: 'SAP-1', closingQty: 100, layerDeathsAndEliminateItemList: source.amortizationData.layerDeathsAndEliminateItemList, transferList: source.amortizationData.transferList }],
      total: 5,
    })
    expect(f.calls[0]).toEqual({ url: '/base/dataRetransmit/list', method: 'get', params: { order: '', orderField: '', type: '121', farm: 'farm-1', yearMonth: '2026-08', scope: 1, pageNo: 2, pageSize: 50 } })
    const defaults = fixture([{ list: [], total: 0 }])
    await defaults.api.listSap()
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', type: '1', farm: '', yearMonth: '', scope: 1, pageNo: 1, pageSize: 20 })
  })

  it('财务单个同步只发送非空farm，全部同步按1至11串行且失败即停', async () => {
    const f = fixture([{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}])
    const prepared = f.api.prepareFinanceSync({ yearMonth: '2026-08', farm: '' })
    await expect(f.api.submitFinanceSync({ draft: prepared.draft, type: 4 })).resolves.toBe(true)
    await expect(f.api.submitFinanceSyncAll({ draft: prepared.draft })).resolves.toEqual([...PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES])
    expect(f.calls[0]).toEqual({ url: '/base/financeRetransmit/uploadAllByDateAndType', method: 'get', params: { yearMonth: '2026-08', type: 4 } })
    expect(f.calls.slice(1).map(call => call.params)).toEqual(PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES.map(type => ({ yearMonth: '2026-08', type })))

    const failed = fixture([{}, new Error('财务同步失败'), {}])
    await expect(failed.api.submitFinanceSyncAll({ draft: { yearMonth: '2026-08', farm: 'farm-1' } })).rejects.toThrow('财务同步失败')
    expect(failed.calls).toHaveLength(2)
    expect(failed.calls[0]?.params).toEqual({ yearMonth: '2026-08', type: 1, farm: 'farm-1' })
    expect(failed.calls[1]?.params).toEqual({ yearMonth: '2026-08', type: 2, farm: 'farm-1' })
  })

  it('表单、类型、日期、详情数组和坏响应反证会失败且不降级为空', async () => {
    const f = fixture([])
    expect(() => f.api.prepareSapUpload({ type: 13, yearMonth: '2026-08', farm: 'farm-1' })).toThrow('类型')
    expect(() => f.api.prepareSapUpload({ type: 1, yearMonth: '2026-8', farm: 'farm-1' })).toThrow('YYYY-MM')
    expect(() => f.api.prepareSapUpload({ type: 1, yearMonth: '2026-08', farm: '' })).toThrow('场区')
    expect(() => f.api.prepareFinanceSync({ yearMonth: '', farm: 'farm-1' })).toThrow('月份')
    await expect(f.api.listSap({ type: 1, yearMonth: '2026-08', pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(fixture([{ list: [{ id: 'x', farmName: '场', month: '2026-08', amortizationData: { transferList: {} } }], total: 1 }]).api.listSap()).rejects.toThrow('必须为数组')
    await expect(fixture([{ list: [], total: -1 }]).api.listSap()).rejects.toThrow('有效list或total')
    await expect(fixture([new Error('无权限')]).api.listSap()).rejects.toThrow('无权限')
    expect(f.calls).toEqual([])
  })

  it('能力定义和AI契约锁定三个tab、嵌套明细、全部同步序列和取消语义', () => {
    expect(productBusinessDataRetransmitCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_BUSINESS_DATA_RETRANSMIT_METHODS))
    expect(productBusinessDataRetransmitCapabilities.every(item => item.pagePath === PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH && item.permission === PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_BUSINESS_DATA_RETRANSMIT_MODULE_TYPE)).toBe(true)
    expect(contracts['product-business-data-retransmit-list-sap']?.output.fields.some(item => item.path === 'list[].layerDeathsAndEliminateItemList[].deathDate')).toBe(true)
    expect(contracts['product-business-data-retransmit-submit-finance-sync-all']?.output.fields.some(item => item.path === '$[]')).toBe(true)
    expect(contracts['product-business-data-retransmit-prepare-sap-upload']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['product-business-data-retransmit-submit-finance-sync-all']?.steps[0]?.instruction).toContain('不能把true解释成目标系统已入账')
    expect(methodContracts['productBusinessDataRetransmit.listSap']?.boundaries.join('\n')).toContain(PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION)
  })
})
