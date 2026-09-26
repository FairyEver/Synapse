import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createSalaryItemCapability,
  SALARY_ITEM_METHODS,
  SALARY_ITEM_PAGE_PATH,
  salaryItemCapabilities,
} from '../src/capabilities/salary-item.js'
import { SALARY_ITEM_AI_CONTRACTS as contracts, SALARY_ITEM_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-salary-item.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSalaryItemCapability(request), calls }
}

const row = { id: 9, name: '基本工资', isMust: 1, attribute: 1, type: 1, scale: 2, carryRule: 1, remark: '固定项' }

describe('薪资项目页面能力', () => {
  it('静态锁定菜单、列表/详情组件、选项、权限和Java端点', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/hr/manage/salary/list.vue'), 'utf8')
    const detail = readFileSync(join(root, 'app/portal/views/dashboard/hr/manage/salary/[mode]/[id].vue'), 'utf8')
    const options = readFileSync(join(root, 'app/portal/views/dashboard/hr/manage/common/salary/options.js'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryItemController.java'), 'utf8')
    expect(menu).toContain(`path: '${SALARY_ITEM_PAGE_PATH}'`)
    expect(page).toContain("getDataListURL: '/salary/item/page'")
    expect(page).toContain('deleteIsBatch: true')
    expect(detail).toContain("/salary/item/checkFormula")
    expect(detail).toContain('http.post(url, formState)')
    expect(detail).toContain('http.put(url, formState)')
    expect(options).toContain('固定项')
    expect(options).toContain('计算项')
    expect(controller).toContain('@RequestMapping("/salary/item")')
    expect(controller).toContain('@GetMapping("getAllSalaryItem")')
    expect(controller).toContain('@GetMapping("checkFormula")')
    expect(controller).toContain('@DeleteMapping')
    expect(salaryItemCapabilities.every(item => item.pagePath === SALARY_ITEM_PAGE_PATH && item.permission === '/dashboard/manage/salary' && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表按Portal发送排序、筛选和分页字段，并规范分页响应', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ attribute: 2, type: 6, name: '奖金', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [{ ...row }], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/salary/item/page', method: 'get',
      params: { order: '', orderField: '', attribute: 2, type: 6, name: '奖金', pageNo: 2, pageSize: 50 },
    })
  })

  it('创建计算项先校验公式，按动态字段规则提交完整表单', async () => {
    const f = fixture([undefined, undefined])
    await f.api.create({ name: '应发工资', attribute: 2, formula: '基本工资+奖金', type: 6, scale: 2, carryRule: 1, remark: '' })
    expect(f.calls).toEqual([
      { url: '/salary/item/checkFormula', method: 'get', params: { formula: '基本工资+奖金' } },
      { url: '/salary/item', method: 'post', data: { name: '应发工资', isMust: 0, attribute: 2, formula: '基本工资+奖金', parameter: '', type: 6, scale: 2, carryRule: 1, remark: '' } },
    ])
  })

  it('系统参数修改清空公式并保留参数，删除使用JSON ID数组', async () => {
    const f = fixture([undefined, undefined])
    await f.api.update({ id: '12', name: '个税起征点', attribute: 4, parameter: 88, formula: '旧公式', type: 5, scale: 0, carryRule: 2, remark: '参数' })
    await f.api.remove({ ids: [12, '13'] })
    expect(f.calls).toEqual([
      { url: '/salary/item', method: 'put', data: { id: '12', name: '个税起征点', isMust: 0, attribute: 4, formula: '', parameter: 88, type: 5, scale: 0, carryRule: 2, remark: '参数' } },
      { url: '/salary/item', method: 'delete', data: [12, '13'] },
    ])
  })

  it('详情、全量候选和非法表单不会静默成功', async () => {
    const f = fixture([row, [row]])
    await expect(f.api.get({ id: 9 })).resolves.toMatchObject({ id: 9, name: '基本工资' })
    await expect(f.api.all()).resolves.toHaveLength(1)
    expect(f.calls).toEqual([
      { url: '/salary/item/9', method: 'get' },
      { url: '/salary/item/getAllSalaryItem', method: 'get' },
    ])
    expect(() => fixture().api.prepareRemove({ ids: [] })).toThrow('至少包含一个')
    await expect(fixture().api.create({ name: ' ', attribute: 1, type: 1, scale: 0, carryRule: 1 })).rejects.toThrow('不能全为空格')
    await expect(fixture().api.create({ name: '公式', attribute: 2, type: 1, scale: 0, carryRule: 1 })).rejects.toThrow('formula必填')
    await expect(fixture().api.create({ name: '参数', attribute: 4, type: 1, scale: 0, carryRule: 1 })).rejects.toThrow('parameter必填')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
  })

  it('AI契约逐能力登记并锁定公式和取消语义', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(SALARY_ITEM_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(SALARY_ITEM_METHODS).map(method => `salaryItem.${method}`))])
    expect(contracts['salary-item-create']?.consume.join('\n')).toContain('attribute')
    expect(contracts['salary-item-check-formula']?.purpose).toContain('校验')
    expect(contracts['salary-item-prepare-remove']?.steps.some(step => step.role === 'cancel')).toBe(true)
  })
})
