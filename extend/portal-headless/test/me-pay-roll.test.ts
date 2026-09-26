import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import {
  createMePayRollCapability,
  mePayRollCapabilities,
  ME_PAY_ROLL_METHODS,
  ME_PAY_ROLL_PAGE_PATH,
} from '../src/capabilities/me-pay-roll.js'
import { BUSINESS_AI_CONTRACTS } from '../src/catalog/contracts-business.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createMePayRollCapability(request), calls }
}

const sampleRow = {
  name: '李某',
  month: '2026-09',
  basicSalary: 10000,
  attendanceSalary: '100.00',
  actualSalaryTotal: null,
  ignoredServerField: '保留',
}

const sampleChart = {
  xAxis: ['一月', '二月'],
  series: [{ name: '应发', data: ['100.00', '0.00'] }, { name: '同期', data: [90, null] }],
}

describe('Portal HR → 我的工资页面能力', () => {
  it('锁定页面、权限、platform实例、module-type和只读动作集合', () => {
    expect(mePayRollCapabilities.map(item => item.id)).toEqual(Object.keys(ME_PAY_ROLL_METHODS))
    expect(mePayRollCapabilities.every(item => item.pagePath === ME_PAY_ROLL_PAGE_PATH)).toBe(true)
    expect(mePayRollCapabilities.every(item => item.permission === '/dashboard/me/pay-roll')).toBe(true)
    expect(mePayRollCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(mePayRollCapabilities.every(item => item.moduleType === 14)).toBe(true)
    expect(mePayRollCapabilities.every(item => !item.write)).toBe(true)
    expect(resolveModuleType(ME_PAY_ROLL_PAGE_PATH).moduleType).toBe(14)
  })

  it('源码锚定表单默认值、接口路径、完整可见列和当前用户权限边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/me/pay-roll/list.vue`, 'utf8')
    const controller = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/controller/ReportSalaryController.java', 'utf8')
    const homepage = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/homepage/controller/HrHomePageController.java', 'utf8')
    expect(source).toContain("getDataListURL: '/salary/report/selectPersonPayrollPage'")
    expect(source).toContain("http.get('/hr/homepage/wagesLineData')")
    expect(source).toContain("http.get('/hr/homepage/fiveInsurancesLinenData')")
    expect(source).toContain("startYearMonth: formatDay(new Date(), 'YYYY-MM')")
    expect(source).toContain("endYearMonth: formatDay(new Date(), 'YYYY-MM')")
    for (const field of ['name', 'month', 'needPaySalary', 'actualSalaryTotal', 'zxsYYEHH', 'pensionGJJ', 'unitYL']) expect(source).toContain(`dataIndex: '${field}'`)
    expect(controller).toContain('@GetMapping("selectPersonPayrollPage")')
    expect(controller).toContain('dto.setStaffCode(SecurityFrameworkUtils.getLoginUser().getUsername())')
    expect(homepage).toContain('@GetMapping("/wagesLineData")')
    expect(homepage).toContain('@GetMapping("/fiveInsurancesLinenData")')
  })

  it('列表逐字段复现Portal默认查询、分页载荷并保留服务端扩展字段', async () => {
    const f = setup([{ list: [sampleRow], total: 1 }])
    await expect(f.api.list({ startYearMonth: '2026-08', endYearMonth: '2026-09', pageNo: 2, pageSize: 20 })).resolves.toMatchObject({
      list: [{ name: '李某', month: '2026-09', basicSalary: 10000, attendanceSalary: '100.00', actualSalaryTotal: null, ignoredServerField: '保留' }],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/salary/report/selectPersonPayrollPage',
      method: 'get',
      params: { order: '', orderField: '', startYearMonth: '2026-08', endYearMonth: '2026-09', pageNo: 2, pageSize: 20 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['order', 'orderField', 'startYearMonth', 'endYearMonth', 'pageNo', 'pageSize'])
  })

  it('省略月份使用当前月，显式null保持清空，非法月份/页大小在发请求前失败', async () => {
    const f = setup([{ list: [], total: 0 }, { list: [], total: 0 }])
    await f.api.list()
    expect((f.calls[0]!.params as Record<string, unknown>).startYearMonth).toMatch(/^\d{4}-\d{2}$/)
    expect((f.calls[0]!.params as Record<string, unknown>).endYearMonth).toMatch(/^\d{4}-\d{2}$/)
    await f.api.list({ startYearMonth: null, endYearMonth: null })
    expect(f.calls[1]!.params).toMatchObject({ startYearMonth: null, endYearMonth: null })
    await expect(f.api.list({ startYearMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    expect(f.calls).toHaveLength(2)
  })

  it('两个图表使用不同Portal接口并补齐页面标题，保留字符串金额', async () => {
    const f = setup([sampleChart, sampleChart])
    await expect(f.api.wagesChart()).resolves.toMatchObject({ title: '应发工资', xAxis: sampleChart.xAxis, series: sampleChart.series })
    await expect(f.api.fiveInsurancesChart()).resolves.toMatchObject({ title: '五险一金', xAxis: sampleChart.xAxis, series: sampleChart.series })
    expect(f.calls).toEqual([
      { url: '/hr/homepage/wagesLineData', method: 'get' },
      { url: '/hr/homepage/fiveInsurancesLinenData', method: 'get' },
    ])
  })

  it('坏响应、权限传播和契约反证不会静默成功', async () => {
    const malformedPage = setup([{ list: [{ name: 7 }], total: 1 }])
    await expect(malformedPage.api.list()).rejects.toThrow('name')
    const malformedChart = setup([{ xAxis: ['一月'], series: [{ name: '应发', data: [{}] }] }])
    await expect(malformedChart.api.wagesChart()).rejects.toThrow('有限数字')
    const denied = setup([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
    expect(BUSINESS_AI_CONTRACTS['me-pay-roll-list']?.inputs.startYearMonth?.format).toBe('YYYY-MM')
    expect(BUSINESS_AI_CONTRACTS['me-pay-roll-list']?.output.fields.some(field => field.path === 'list[].actualSalaryTotal')).toBe(true)
    expect(BUSINESS_AI_CONTRACTS['me-pay-roll-list']?.boundaries.some(item => item.includes('staffCode'))).toBe(true)
  })
})
