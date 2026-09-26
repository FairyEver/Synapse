import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingProjectCapability,
  FINANCE_SETTING_PROJECT_METHODS,
  FINANCE_SETTING_PROJECT_PAGE_PATH,
  financeSettingProjectCapabilities,
} from '../src/capabilities/finance-setting-project.js'
import type { FinanceSettingProjectDetail } from '../src/capabilities/finance-setting-project.js'
import {
  FINANCE_SETTING_PROJECT_CONTRACTS as contracts,
  FINANCE_SETTING_PROJECT_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-project.js'

type RequestConfig = Parameters<PortalRequest>[0]

const detail: FinanceSettingProjectDetail = {
  id: '9007199254740993',
  projectName: 'SDK测试项目',
  projectCode: 'SDK-P-001',
  projectType: 1,
  projectAttribute: 2,
  companyId: 71,
  companyName: '测试公司',
  principalStaffId: 82,
  principalStaffNo: 'U0082',
  principalName: '测试负责人',
  status: 1,
  createTime: '2026-09-22 10:20:30',
  updateTime: '2026-09-22 10:20:30',
  stages: [
    { id: 91, stage: 1, stageName: '研究阶段', startDate: '2026-01-01', endDate: '2026-03-31' },
    { id: 92, stage: 2, stageName: '开发阶段', startDate: '2026-04-01', endDate: '2026-06-30' },
  ],
}

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createFinanceSettingProjectCapability(request), calls }
}

describe('财务设置→项目管理PC页面能力', () => {
  it('目录绑定页面、platform、moduleType=null，并区分页面按钮写能力', () => {
    expect(financeSettingProjectCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_PROJECT_METHODS))
    expect(financeSettingProjectCapabilities.every(item => item.pagePath === FINANCE_SETTING_PROJECT_PAGE_PATH)).toBe(true)
    expect(financeSettingProjectCapabilities.every(item => item.permission === '/dashboard/finance/setting/project')).toBe(true)
    expect(financeSettingProjectCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingProjectCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(financeSettingProjectCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'finance-setting-project-create', 'finance-setting-project-update', 'finance-setting-project-enable', 'finance-setting-project-disable', 'finance-setting-project-remove',
    ])
  })

  it('静态源码锁定菜单、列表、表单动作、按钮权限及无导入导出', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const list = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/project/list.vue'), 'utf8')
    const form = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/project/[mode]/[id].vue'), 'utf8')
    expect(list).toContain("getDataListURL: '/admin-api/finance/project/page'")
    expect(list).toContain("http.put('/admin-api/finance/project/enable'")
    expect(list).toContain("http.put('/admin-api/finance/project/disable'")
    expect(list).toContain("http.delete('/admin-api/finance/project/delete'")
    expect(form).toContain("http.get('/admin-api/finance/project/get'")
    expect(form).toContain("http.post('/admin-api/finance/project/create'")
    expect(form).toContain("http.put('/admin-api/finance/project/update'")
    for (const permission of ['create', 'update', 'delete', 'enable', 'disable', 'query']) expect(list).toContain(`finance:setting:project:${permission}`)
    expect(list).not.toMatch(/export-excel|download|upload/i)
  })

  it('列表复刻页面默认表单、数组筛选和公司ID逗号映射，并投影阶段', async () => {
    const { api, calls } = setup({ list: [detail], total: 1 })
    const result = await api.list({ projectName: '测试', projectTypes: [1, 3], projectAttributes: [2], stages: [1], companyIds: [71, '72'], principalName: '负责人', pageNo: 2, pageSize: 50 })
    expect(calls[0]).toEqual({
      url: '/admin-api/finance/project/page', method: 'get',
      params: {
        order: '', orderField: '', projectName: '测试', projectCode: null,
        projectTypes: [1, 3], projectAttributes: [2], stages: [1], companyIds: '71,72', principalName: '负责人', status: 1, pageNo: 2, pageSize: 50,
      },
    })
    expect(result.list[0]).toEqual({ ...detail, stages: detail.stages })
  })

  it('详情请求使用id，组织树复刻页面请求，负责人搜索强制关键字并限制小页', async () => {
    const tree = [{ id: 71, name: '测试公司', isCorporation: 1, pid: 0, children: [{ id: 72, name: '部门', isCorporation: 0, pid: 71, children: [] }] }]
    const { api, calls } = setup(detail, tree, { list: [{ id: 82, realName: '测试负责人', username: 'U0082' }], total: 1 })
    await expect(api.get({ id: detail.id })).resolves.toMatchObject({ id: detail.id, projectName: detail.projectName })
    await expect(api.organizationTree()).resolves.toEqual([{ ...tree[0]!, pid: null, children: [{ ...tree[0]!.children[0]!, pid: 71, children: [] }] }])
    await expect(api.searchUsers({ keyword: ' 负责人 ', pageNo: 2, pageSize: 25 })).resolves.toEqual({ list: [{ id: 82, realName: '测试负责人', username: 'U0082', label: '测试负责人(U0082)' }], total: 1 })
    expect(calls.map(call => call.params)).toEqual([{ id: detail.id }, { excludePost: false }, { pageNo: 2, pageSize: 25, name: '负责人', statusList: '1,4' }])
    const rejected = setup()
    await expect(rejected.api.searchUsers({ keyword: ' ' })).rejects.toThrow('非空关键字')
    await expect(rejected.api.searchUsers({ keyword: '人', pageSize: 101 })).rejects.toThrow('1至100')
    expect(rejected.calls).toHaveLength(0)
  })

  it('prepareCreate复刻表单默认值，create提交完整页面字段并返回Long ID', async () => {
    const { api, calls } = setup('9007199254740994')
    const prepared = api.prepareCreate({ projectName: '新增项目', projectCode: 'NEW-001', projectType: 1, projectAttribute: 1, principalStaffId: 82 })
    expect(prepared.draft).toEqual({
      id: '', projectName: '新增项目', projectCode: 'NEW-001', projectType: 1, projectAttribute: 1,
      companyId: null, companyName: '', principalStaffId: 82, principalStaffNo: '', principalName: '', status: 1,
      stages: [{ stage: 1, startDate: '', endDate: '' }, { stage: 2, startDate: '', endDate: '' }],
    })
    await expect(api.create(prepared.draft)).resolves.toBe('9007199254740994')
    expect(calls[0]).toEqual({ url: '/admin-api/finance/project/create', method: 'post', data: prepared.draft })
  })

  it('编辑只允许阶段日期，锁定两端日期和研究→开发顺序', async () => {
    const { api, calls } = setup(true, true)
    const prepared = api.prepareUpdate({ current: detail, changes: { stages: [{ stage: 1, startDate: '2026-02-01', endDate: '2026-05-01' }, { stage: 2, startDate: '2026-05-02', endDate: '2026-06-01' }] } })
    expect(prepared.previous.id).toBe(detail.id)
    expect(prepared.draft.projectName).toBe(detail.projectName)
    expect(prepared.draft.stages).toEqual([{ stage: 1, startDate: '2026-02-01', endDate: '2026-05-01' }, { stage: 2, startDate: '2026-05-02', endDate: '2026-06-01' }])
    await expect(api.update({ current: prepared.draft })).resolves.toBe(true)
    expect(calls[0]).toEqual({ url: '/admin-api/finance/project/update', method: 'put', data: prepared.draft })
    const compensation = api.prepareUpdate({ current: prepared.draft, changes: { stages: prepared.previous.stages } })
    await expect(api.update({ current: compensation.draft })).resolves.toBe(true)
    expect(calls[1]).toEqual({ url: '/admin-api/finance/project/update', method: 'put', data: compensation.draft })
    expect(compensation.draft.stages).toEqual(prepared.previous.stages)
    expect(() => api.prepareUpdate({ current: detail, changes: { projectName: '越权修改' } as never })).toThrow('不支持字段projectName')
    expect(() => api.prepareUpdate({ current: detail, changes: { stages: [{ stage: 1, startDate: '2026-01-01', endDate: '' }] } })).toThrow('同时填写')
    expect(() => api.prepareUpdate({ current: detail, changes: { stages: [{ stage: 1, startDate: '2026-05-01', endDate: '2026-06-01' }, { stage: 2, startDate: '2026-04-01', endDate: '2026-07-01' }] } })).toThrow('研究阶段')
  })

  it('启停按页面当前状态选择不同端点，删除使用query id且只接受true', async () => {
    const ok = setup(true, true, true)
    await expect(ok.api.enable({ id: detail.id, currentStatus: 0 })).resolves.toBe(true)
    await expect(ok.api.disable({ id: detail.id, currentStatus: 1 })).resolves.toBe(true)
    await expect(ok.api.remove(detail.id)).resolves.toBe(true)
    expect(ok.calls).toEqual([
      { url: '/admin-api/finance/project/enable', method: 'put', params: { id: detail.id } },
      { url: '/admin-api/finance/project/disable', method: 'put', params: { id: detail.id } },
      { url: '/admin-api/finance/project/delete', method: 'delete', params: { id: detail.id } },
    ])
    const rejected = setup()
    await expect(rejected.api.enable({ id: detail.id, currentStatus: 1 })).rejects.toThrow('停用')
    await expect(rejected.api.disable({ id: detail.id, currentStatus: 0 })).rejects.toThrow('启用')
    expect(rejected.calls).toHaveLength(0)
  })

  it('写响应错误不吞掉，非法参数不发请求', async () => {
    const failed = setup(new Error('项目被引用'))
    await expect(failed.api.remove(detail.id)).rejects.toThrow('被引用')
    const invalid = setup()
    expect(() => invalid.api.prepareCreate({ projectName: ' ', projectCode: 'X', projectType: 1, projectAttribute: 1, principalStaffId: 82 })).toThrow()
    await expect(invalid.api.list({ pageSize: -1 })).rejects.toThrow()
    expect(invalid.calls).toHaveLength(0)
  })
})

describe('财务项目AI契约', () => {
  it('每个能力有结构化契约，完整检查保留真实验证缺口', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_PROJECT_METHODS))
    expect(validateAiContracts(contracts, { definitions: financeSettingProjectCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: financeSettingProjectCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(Object.keys(contracts).length).fill('incomplete-evidence'))
    expect(Object.values(contracts).every(contract => contract.gaps?.some(gap => gap.includes('未启动浏览器')))).toBe(true)
  })

  it('关键映射锁住阶段、负责人ID、启停状态和删除ID', () => {
    expect(contracts['finance-setting-project-prepare-create']?.steps[0]?.mapping).toMatchObject({ principalStaffId: 'result.draft.principalStaffId', stages: 'result.draft.stages' })
    expect(contracts['finance-setting-project-update']?.steps[0]?.mapping).toEqual({ id: 'args.current.id' })
    expect(contracts['finance-setting-project-enable']?.steps[0]?.mapping).toEqual({ id: 'args.id' })
    expect(contracts['finance-setting-project-remove']?.steps[0]?.mapping).toEqual({ id: 'args.id' })
    expect(contracts['finance-setting-project-user-search']?.output.fields.map(field => field.path)).toContain('list[].id')
    expect(methodContracts['financeSettingProject.create']?.boundaries.join(' ')).toContain('公开方法')
  })
})
