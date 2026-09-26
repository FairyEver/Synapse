import { describe, expect, it } from 'vitest'
import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { createSettingRoleCapability, settingRoleCapabilities } from '../src/capabilities/setting-role.js'
import type { PortalRequest } from '../src/session/types.js'

type Call = Parameters<PortalRequest>[0]

function harness (responses: unknown[] = []) {
  const calls: Call[] = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
    calls.push(config)
    return responses.shift() as T
  }
  return { calls, cap: createSettingRoleCapability(request) }
}

const scope = (overrides: Record<string, unknown> = {}) => ({
  moduleType: 11,
  dataScopeType: 4,
  organizationIdList: [101],
  gradeIdList: [],
  legalPersonIdList: [],
  ...overrides,
})

const form = (overrides: Record<string, unknown> = {}) => ({
  id: '',
  useSystem: 4,
  roleIdentifier: 'role-code',
  name: '角色A',
  menuIdList: [1, '2'],
  remark: '备注',
  roleModuleDataScopeRelList: [scope()],
  ...overrides,
})

describe('setting-role capability', () => {
  it('复刻列表的pageSize请求字段、默认值和返回投影', async () => {
    const { cap, calls } = harness([{ list: [{ id: 1, name: '角色A', roleIdentifier: 'A', remark: null, useSystem: 4, createDate: '2026-01-01 00:00:00', children: [] }], total: 1 }])
    await expect(cap.list({ name: null })).resolves.toEqual({
      list: [{ id: 1, name: '角色A', roleIdentifier: 'A', remark: null, useSystem: 4, createDate: '2026-01-01 00:00:00', children: [] }],
      total: 1,
    })
    expect(calls[0]).toEqual({
      url: '/admin-api/sys/role/allProjectRoleByPage',
      method: 'get',
      params: { order: '', orderField: '', name: '', pageNo: 1, pageSize: 20 },
    })
    await expect(cap.list({ pageSize: 25 })).rejects.toThrow('pageSize')
  })

  it('详情复刻Portal去掉parentId并归一模块权限数组', async () => {
    const { cap, calls } = harness([{
      id: '10',
      parentId: 1,
      useSystem: null,
      roleIdentifier: null,
      name: '角色A',
      menuIdList: null,
      remark: null,
      dataScope: 1,
      roleModuleDataScopeRelList: [
        { moduleType: 23, dataScopeType: 4, organizationIdList: [101], gradeIdList: null, legalPersonIdList: [0, '202'] },
        { moduleType: 41, dataScopeType: 128, organizationIdList: [999], gradeIdList: [303], legalPersonIdList: [404] },
      ],
    }])
    const result = await cap.getInfo({ id: '10' })
    expect(result).toMatchObject({ id: '10', menuIdList: [], remark: null, roleIdentifier: null })
    expect(result).not.toHaveProperty('parentId')
    expect(result.roleModuleDataScopeRelList).toEqual([
      { moduleType: 23, dataScopeType: 4, organizationIdList: [101], gradeIdList: [], legalPersonIdList: ['202'] },
      { moduleType: 41, dataScopeType: 128, organizationIdList: [], gradeIdList: [], legalPersonIdList: [] },
    ])
    expect(calls[0]).toEqual({ url: '/admin-api/sys/role/info/10', method: 'get' })
  })

  it('逐个复刻表单候选端点，班级候选必须先按关键字分页', async () => {
    const { cap, calls } = harness([
      [{ id: 1, name: '菜单', children: [] }],
      [{ id: 2, name: '组织', children: [] }],
      [{ id: 3, dictLabel: '标准单元', children: [] }],
      [{ id: 4, name: '部门类型' }],
      [{ id: 5, name: '法人', superOrganizationName: null, mainInvest: null }],
      { list: [{ id: 6, name: '班级' }], total: 1 },
    ])
    await expect(cap.menuOptions({ useSystem: 4 })).resolves.toMatchObject([{ id: 1, name: '菜单', children: [] }])
    await expect(cap.organizationTree()).resolves.toMatchObject([{ id: 2, name: '组织' }])
    await expect(cap.standardTree()).resolves.toMatchObject([{ id: 3, dictLabel: '标准单元' }])
    await expect(cap.organizationTypeOptions()).resolves.toEqual([{ id: 4, name: '部门类型' }])
    await expect(cap.legalPersonOptions()).resolves.toMatchObject([{ id: 5, name: '法人' }])
    await expect(cap.gradeOptions({ keyword: '班', pageNo: 1, pageSize: 20 })).resolves.toEqual([{ id: 6, name: '班级' }])
    expect(calls).toEqual([
      { url: '/admin-api/sys/menu/select-role-menu-by-tenant', method: 'get', params: { useSystem: 4 } },
      { url: '/org/organization/getRoleOrganizationTree', method: 'get' },
      { url: '/admin-api/sys/role/getStandardTree', method: 'get' },
      { url: '/org/organizationType/selectAll', method: 'get' },
      { url: '/org/corporation/getAllLegalPerson', method: 'get' },
      { url: '/study/grade/studygrade/page', method: 'get', params: { name: '班', pageNo: 1, pageSize: 20 } },
    ])
    await expect(cap.gradeOptions({ keyword: '   ' })).rejects.toThrow('关键字')
    expect(calls).toHaveLength(6)
  })

  it('新建prepare严格复刻完整表单、强制dataScope=2并清理128范围', () => {
    const { cap, calls } = harness()
    const prepared = cap.prepareCreate({ form: form({
      roleModuleDataScopeRelList: [
        scope({ moduleType: 23, legalPersonIdList: [0, '202'] }),
        scope({ moduleType: 41, dataScopeType: 128, organizationIdList: [999], gradeIdList: [303], legalPersonIdList: [404] }),
      ],
    }) })
    expect(calls).toHaveLength(0)
    expect(prepared).toEqual({
      mode: 'create',
      previous: null,
      draft: {
        id: '', useSystem: 4, roleIdentifier: 'role-code', name: '角色A', menuIdList: [1, '2'], remark: '备注', dataScope: 2,
        roleModuleDataScopeRelList: [
          { moduleType: 23, dataScopeType: 4, organizationIdList: [101], gradeIdList: [], legalPersonIdList: ['202'] },
          { moduleType: 41, dataScopeType: 128, organizationIdList: [], gradeIdList: [], legalPersonIdList: [] },
        ],
      },
    })
  })

  it('学习模块和自定义组织范围遵守Portal表单规则，并拒绝重复模块', () => {
    const { cap } = harness()
    expect(() => cap.prepareCreate({ form: form({ roleModuleDataScopeRelList: [scope({ moduleType: 12, dataScopeType: 4, organizationIdList: [], gradeIdList: [] })] }) })).toThrow('班级')
    expect(() => cap.prepareCreate({ form: form({ roleModuleDataScopeRelList: [scope({ organizationIdList: [] })] }) })).toThrow('组织范围')
    expect(() => cap.prepareCreate({ form: form({ roleModuleDataScopeRelList: [scope(), scope()] }) })).toThrow('重复')
    expect(() => cap.prepareCreate({ form: form({ name: '   ' }) })).toThrow('角色名称')
  })

  it('create与update只提交prepare产生的完整草稿，且URL/方法/body逐字锁定', async () => {
    const { cap, calls } = harness()
    const createPrepared = cap.prepareCreate({ form: form() })
    await cap.create({ draft: createPrepared.draft })
    const current = {
      id: 10, useSystem: 1, roleIdentifier: 'old', name: '旧角色', menuIdList: [7], remark: '', dataScope: 2,
      roleModuleDataScopeRelList: [scope({ moduleType: 11, organizationIdList: [101] })],
    }
    const updatePrepared = cap.prepareUpdate({ current, changes: { name: '新角色' } })
    await cap.update({ draft: updatePrepared.draft })
    expect(calls).toEqual([
      { url: '/admin-api/sys/role/saveRoleV1', method: 'post', data: createPrepared.draft },
      { url: '/admin-api/sys/role/updateRoleV1', method: 'post', data: updatePrepared.draft },
    ])
    expect(updatePrepared.previous?.id).toBe(10)
    expect(updatePrepared.draft.name).toBe('新角色')
  })

  it('删除prepare不发请求，提交时DELETE body是ID数组并可批量', async () => {
    const { cap, calls } = harness()
    const prepared = cap.prepareDelete({ ids: [1, '2'] })
    expect(calls).toHaveLength(0)
    await cap.remove({ draft: prepared.draft })
    expect(calls).toEqual([{ url: '/admin-api/sys/role', method: 'delete', data: [1, '2'] }])
    expect(() => cap.prepareDelete({ ids: [] })).toThrow('非空')
  })

  it('注册到页面目录、调用映射和AI契约，且边界明确排除独立生产页面', () => {
    const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
    expect(settingRoleCapabilities).toHaveLength(14)
    expect(settingRoleCapabilities.every(item => item.pagePath === '/dashboard/setting/role/list' && item.permission === '/dashboard/setting/role' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    const updateDescription = catalog.describe('setting-role-update')
    const llmDescription = catalog.describe('setting-role-update-llm')
    if (!updateDescription.ok || !updateDescription.ai || !llmDescription.ok || !llmDescription.ai) throw new Error('角色管理AI描述没有注册')
    expect(updateDescription).toMatchObject({ ok: true, invoke: { sdkPath: 'settingRole.update' } })
    expect(llmDescription.ai.boundaries.join(' ')).toContain('独立生产')
    expect(updateDescription.ai.steps.find(step => step.role === 'required')?.mapping).toEqual({ id: 'args.draft.id' })
  })
})
