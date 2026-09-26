import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createTechnologyTypeTemplateMappingCapability,
  technologyTypeTemplateMappingCapabilities,
  TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHODS,
} from '../src/capabilities/technology-type-template-mapping.js'
import {
  TECHNOLOGY_TYPE_TEMPLATE_MAPPING_CONTRACTS as contracts,
  TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-technology-type-template-mapping.js'

type RequestConfig = Parameters<PortalRequest>[0]

const mapping = {
  id: '7001',
  projectTypeId: '101',
  projectTypeName: '生物研发',
  templateVersionId: '501',
  templateName: '生物项目模板',
  versionNo: '1.0',
  effectiveStartTime: '2026-09-25T09:00:00',
  effectiveEndTime: null,
  displayStatus: 'effective',
  remark: '初始映射',
  status: 'enabled' as const,
}

function setup(...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createTechnologyTypeTemplateMappingCapability(request), calls }
}

describe('类型模板映射页面能力', () => {
  it('列表逐字段发送页面默认查询并保留映射行字段', async () => {
    const { api, calls } = setup({ list: [mapping], total: 1 })
    const result = await api.list({ pageNo: 2, pageSize: 50, projectTypeId: '101' })
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/type-template-mapping/page',
      method: 'get',
      params: { pageNo: 2, pageSize: 50, projectTypeId: '101' },
    })
    expect(result).toEqual({ list: [{ ...mapping, effectiveStartTime: mapping.effectiveStartTime }], total: 1 })
    expect(result.list[0]?.status).toBe('enabled')
  })

  it('列表默认发送pageNo/pageSize/projectTypeId=null，分页范围和ID在请求前校验', async () => {
    const { api, calls } = setup({ list: [], total: 0 })
    await expect(api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(calls[0]?.params).toEqual({ pageNo: 1, pageSize: 20, projectTypeId: null })
    for (const query of [{ pageNo: 0 }, { pageSize: 501 }, { projectTypeId: 0 }, { projectTypeId: '01' }]) {
      await expect(api.list(query as never)).rejects.toThrow()
    }
    expect(calls).toHaveLength(1)
  })

  it('references复刻页面的项目类型、模板和逐模板已发布版本请求', async () => {
    const { api, calls } = setup(
      [{ id: '101', typeName: '生物研发', projectDomain: 'biology' }],
      { list: [{ id: '201', templateName: '生物模板', projectDomain: 'biology' }], total: 1 },
      { list: [{ id: '501', templateId: '201', versionNo: '1.0', versionName: '初始版' }], total: 1 },
    )
    await expect(api.references()).resolves.toEqual({
      projectTypes: [{ id: '101', typeName: '生物研发', projectDomain: 'biology' }],
      templates: [{ id: '201', templateName: '生物模板', projectDomain: 'biology' }],
      publishedVersions: [{ id: '501', templateId: '201', versionNo: '1.0', versionName: '初始版' }],
    })
    expect(calls).toEqual([
      { url: '/admin-api/technology/setting/project-type/simple-list', method: 'get', params: { status: null } },
      { url: '/admin-api/technology/setting/template/page', method: 'get', params: { pageNo: 1, pageSize: 500 } },
      { url: '/admin-api/technology/setting/template/version/page', method: 'get', params: { templateId: '201', versionStatus: 'published', pageNo: 1, pageSize: 500 } },
    ])
  })

  it('新增准备和提交复刻必填字段、默认值与id=null', async () => {
    const { api, calls } = setup(true)
    const prepared = api.prepareCreate({
      projectTypeId: '101',
      templateVersionId: '501',
      effectiveStartTime: '2026-09-25 09:00:00',
    })
    expect(prepared).toEqual({ draft: {
      projectTypeId: '101',
      templateVersionId: '501',
      effectiveStartTime: '2026-09-25 09:00:00',
      effectiveEndTime: null,
      status: 'enabled',
      remark: '',
    } })
    await expect(api.create(prepared)).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/type-template-mapping/create',
      method: 'post',
      data: { id: null, ...prepared.draft },
    })
  })

  it('编辑把列表ISO时间归一为页面提交格式且禁止修改项目类型', async () => {
    const { api, calls } = setup(true)
    const prepared = api.prepareUpdate({
      current: mapping,
      changes: { templateVersionId: '502', effectiveEndTime: '2026-10-01 00:00:00', remark: '调整' },
    })
    expect(prepared.previous).toEqual({
      id: '7001', projectTypeId: '101', templateVersionId: '501', effectiveStartTime: '2026-09-25 09:00:00', effectiveEndTime: null, status: 'enabled', remark: '初始映射',
    })
    expect(prepared.draft).toEqual({ ...prepared.previous, templateVersionId: '502', effectiveEndTime: '2026-10-01 00:00:00', remark: '调整' })
    await expect(api.update({ draft: prepared.draft })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({ url: '/admin-api/technology/setting/type-template-mapping/update', method: 'put', data: prepared.draft })
    expect(() => api.prepareUpdate({ current: mapping, changes: { projectTypeId: '999' } as never })).toThrow('projectTypeId')
  })

  it('启停根据目标enabled选择enable/disable URL且只发送id查询参数', async () => {
    const { api, calls } = setup(true, true)
    const enabled = api.prepareChangeStatus({ id: '7001', enabled: false })
    await expect(api.changeStatus(enabled)).resolves.toBeUndefined()
    const disabled = api.prepareChangeStatus({ id: '7001', enabled: true })
    await expect(api.changeStatus(disabled)).resolves.toBeUndefined()
    expect(calls).toEqual([
      { url: '/admin-api/technology/setting/type-template-mapping/disable', method: 'put', params: { id: '7001' }, data: null },
      { url: '/admin-api/technology/setting/type-template-mapping/enable', method: 'put', params: { id: '7001' }, data: null },
    ])
  })

  it('日期、状态、必填ID与错误响应在发请求前或原样失败', async () => {
    const { api, calls } = setup()
    for (const input of [
      { projectTypeId: '101', templateVersionId: '501', effectiveStartTime: null },
      { projectTypeId: '101', templateVersionId: '501', effectiveStartTime: '2026/09/25 09:00:00' },
      { projectTypeId: '101', templateVersionId: '501', effectiveStartTime: '2026-09-25 09:00:00', status: 'on' },
      { projectTypeId: '101', templateVersionId: '501', effectiveStartTime: '2026-09-25 09:00:00', effectiveEndTime: 'not-date' },
    ]) expect(() => api.prepareCreate(input as never)).toThrow()
    await expect(setup(new Error('权限不足')).api.create({ draft: {
      projectTypeId: '101', templateVersionId: '501', effectiveStartTime: '2026-09-25 09:00:00', effectiveEndTime: null, status: 'enabled', remark: '',
    } })).rejects.toThrow('权限不足')
    expect(calls).toHaveLength(0)
  })
})

describe('类型模板映射AI契约', () => {
  it('动作、公开方法和完整证据缺口结构通过', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(technologyTypeTemplateMappingCapabilities).toHaveLength(8)
    expect(validateAiContracts(contracts, { definitions: technologyTypeTemplateMappingCapabilities, contracts })).toEqual([])
    expect(Object.keys(methodContracts)).toEqual(Object.values(TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHODS).map(method => `technologyTypeTemplateMapping.${method}`))
    expect(validateAiContracts(contracts, { profile: 'complete', definitions: technologyTypeTemplateMappingCapabilities, contracts }).map((issue: { code: string }) => issue.code)).toEqual(Array(8).fill('incomplete-evidence'))
  })

  it('契约锁定页面关键提交和后续回查规则', () => {
    expect(contracts['technology-type-template-mapping-create']?.steps[0]?.mapping).toEqual({})
    expect(contracts['technology-type-template-mapping-prepare-update']?.inputs).not.toHaveProperty('changes.projectTypeId')
    expect(contracts['technology-type-template-mapping-change-status']?.boundaries.join(' ')).toContain('displayStatus')
    expect(contracts['technology-type-template-mapping-list']?.output.fields.map(item => item.path)).toContain('list[].effectiveStartTime')
  })
})
