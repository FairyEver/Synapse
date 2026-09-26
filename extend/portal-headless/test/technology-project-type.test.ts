import axios from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { createPortalHeadless } from '../src/index.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createTechnologyProjectTypeCapability,
  technologyProjectTypeCapabilities,
  TECHNOLOGY_PROJECT_TYPE_METHODS,
  TECHNOLOGY_PROJECT_TYPE_ROLES,
} from '../src/capabilities/technology-project-type.js'
import {
  TECHNOLOGY_PROJECT_TYPE_CONTRACTS as contracts,
  TECHNOLOGY_PROJECT_TYPE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-technology-project-type.js'

type RequestConfig = Parameters<PortalRequest>[0]
const originalAdapter = axios.defaults.adapter
afterEach(() => { axios.defaults.adapter = originalAdapter })

const row = {
  id: '9007199254740997',
  typeCode: 'BIO-01',
  codeAbbreviation: 'bio1',
  roleCodes: ['project_owner', 'project_member'],
  typeName: '生物研发',
  projectDomain: 'biology',
  status: 0,
  sort: 1.5,
  remark: '测试',
  updateTime: '2026-09-22 09:00:00',
  creator: 'not-page-data',
}

function setup(...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createTechnologyProjectTypeCapability(request), calls }
}

describe('门户项目类型PC功能', () => {
  it('列表逐字段发送PC查询并只返回页面显示和编辑所需字段', async () => {
    const { api, calls } = setup({ list: [row, { ...row, id: 2, roleCodes: null, codeAbbreviation: null, remark: null, sort: null, updateTime: null }], total: 23 })
    const result = await api.list({ pageNo: 2, pageSize: 50, code: 'BIO', name: '研发', projectDomain: 'biology' })
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/project-type/page',
      method: 'get',
      params: { pageNo: 2, pageSize: 50, code: 'BIO', name: '研发', projectDomain: 'biology' },
    })
    expect(result).toEqual({
      list: [
        { id: row.id, typeCode: 'BIO-01', codeAbbreviation: 'bio1', roleCodes: ['project_owner', 'project_member'], typeName: '生物研发', projectDomain: 'biology', status: 0, sort: 1.5, remark: '测试', updateTime: '2026-09-22 09:00:00' },
        { id: 2, typeCode: 'BIO-01', codeAbbreviation: null, roleCodes: [...TECHNOLOGY_PROJECT_TYPE_ROLES], typeName: '生物研发', projectDomain: 'biology', status: 0, sort: null, remark: null, updateTime: null },
      ],
      total: 23,
    })
    expect(result.list[0]).not.toHaveProperty('creator')
  })

  it('列表默认值不擅自添加renren order字段，空页保持当前页语义', async () => {
    const { api, calls } = setup({ list: [], total: 0 })
    await expect(api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(calls[0]?.params).toEqual({ pageNo: 1, pageSize: 20, code: null, name: null, projectDomain: null })
    expect(calls[0]?.params).not.toHaveProperty('order')
    expect(calls[0]?.params).not.toHaveProperty('orderField')
  })

  it('prepareCreate补齐PC默认值，create只提交弹窗字段并显式发送id=null', async () => {
    const { api, calls } = setup({ ignored: 'server value' })
    const prepared = api.prepareCreate({ typeCode: 'BIO-02', typeName: '育种', projectDomain: 'biology' })
    expect(prepared).toEqual({ draft: {
      typeCode: 'BIO-02', codeAbbreviation: null, roleCodes: [...TECHNOLOGY_PROJECT_TYPE_ROLES], typeName: '育种', projectDomain: 'biology', status: 0, sort: 0, remark: '',
    } })
    await expect(api.create(prepared.draft)).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/project-type/create', method: 'post',
      data: { id: null, typeCode: 'BIO-02', codeAbbreviation: null, roleCodes: [...TECHNOLOGY_PROJECT_TYPE_ROLES], typeName: '育种', projectDomain: 'biology', status: 0, sort: 0, remark: '' },
    })
  })

  it('prepareUpdate仅合并可编辑字段并保留旧快照，update不允许借changes改编码或大类', async () => {
    const { api, calls } = setup(true)
    const prepared = api.prepareUpdate({
      current: row,
      changes: { typeName: '生物研发二类', status: 1, remark: null, typeCode: 'HACK', projectDomain: 'engineering' } as never,
    })
    expect(prepared.previous).toEqual({ id: row.id, typeCode: 'BIO-01', codeAbbreviation: 'bio1', roleCodes: ['project_owner', 'project_member'], typeName: '生物研发', projectDomain: 'biology', status: 0, sort: 1.5, remark: '测试' })
    expect(prepared.draft).toEqual({ ...prepared.previous, typeName: '生物研发二类', status: 1, remark: null })
    await expect(api.update({ current: prepared.draft })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({ url: '/admin-api/technology/setting/project-type/update', method: 'put', data: prepared.draft })
  })

  it('恢复编辑是再次提交previous可编辑字段，不把服务端快照伪装成事务回滚', async () => {
    const { api, calls } = setup(true, true)
    const prepared = api.prepareUpdate({ current: row, changes: { typeName: '新名称', roleCodes: ['promotion_owner'] } })
    await api.update({ current: prepared.draft })
    await api.update({ current: prepared.draft, changes: {
      codeAbbreviation: prepared.previous.codeAbbreviation,
      roleCodes: prepared.previous.roleCodes as never,
      typeName: prepared.previous.typeName,
      status: prepared.previous.status,
      sort: prepared.previous.sort,
      remark: prepared.previous.remark,
    } })
    expect(calls[1]?.data).toEqual(prepared.previous)
  })

  it('删除只发列表记录ID并丢弃后端成功业务值，失败不吞掉', async () => {
    const ok = setup(true)
    await expect(ok.api.remove(row.id)).resolves.toBeUndefined()
    expect(ok.calls[0]).toEqual({ url: '/admin-api/technology/setting/project-type/delete', method: 'delete', params: { id: row.id } })
    const failed = setup(new Error('项目类型被引用'))
    await expect(failed.api.remove(2)).rejects.toThrow('被引用')
    expect(failed.calls).toHaveLength(1)
  })

  it('前端校验在发请求前生效，但不擅自把排序限制成整数', async () => {
    const { api, calls } = setup()
    for (const draft of [
      { typeCode: ' ', typeName: '名称', projectDomain: 'biology' },
      { typeCode: 'A', typeName: ' ', projectDomain: 'biology' },
      { typeCode: 'A', typeName: '名称', projectDomain: 'other' },
      { typeCode: 'A', typeName: '名称', projectDomain: 'biology', codeAbbreviation: '1bad' },
      { typeCode: 'A', typeName: '名称', projectDomain: 'biology', roleCodes: [] },
      { typeCode: 'A', typeName: '名称', projectDomain: 'biology', status: 2 },
      { typeCode: 'A', typeName: '名称', projectDomain: 'biology', sort: -1 },
    ]) await expect(api.create(draft as never)).rejects.toThrow()
    expect(() => api.prepareCreate({ typeCode: 'A', typeName: '名称', projectDomain: 'biology', sort: 1.25 })).not.toThrow()
    for (const query of [{ pageNo: 0 }, { pageSize: -1 }, { pageSize: 501 }, { projectDomain: 'other' }]) {
      await expect(api.list(query as never)).rejects.toThrow()
    }
    for (const id of [0, -1, Number.MAX_SAFE_INTEGER + 1, '', '01', 'abc']) await expect(api.remove(id)).rejects.toThrow('id')
    expect(calls).toHaveLength(0)
  })
})

describe('门户项目类型AI契约', () => {
  it('六个动作和公开方法契约结构通过，后端与真实验证缺口保持显式', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(technologyProjectTypeCapabilities).toHaveLength(6)
    expect(validateAiContracts(contracts, { definitions: technologyProjectTypeCapabilities, contracts })).toEqual([])
    expect(Object.keys(methodContracts)).toEqual(Object.values(TECHNOLOGY_PROJECT_TYPE_METHODS).map(method => `technologyProjectType.${method}`))
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: technologyProjectTypeCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(6).fill('incomplete-evidence'))
    for (const contract of Object.values(contracts)) {
      expect(contract.gaps?.join(' ')).toContain('固定后端dcb3f360194')
      expect(contract.boundaries.join(' ')).toContain('没有独立启停按钮')
    }
  })

  it('动作映射锁住根对象、不可编辑字段和删除回查上下文', () => {
    expect(contracts['technology-project-type-prepare-create']?.steps[0]?.mapping).toEqual({
      typeCode: 'result.draft.typeCode', codeAbbreviation: 'result.draft.codeAbbreviation', roleCodes: 'result.draft.roleCodes', typeName: 'result.draft.typeName', projectDomain: 'result.draft.projectDomain', status: 'result.draft.status', sort: 'result.draft.sort', remark: 'result.draft.remark',
    })
    const prepareUpdate = contracts['technology-project-type-prepare-update']!
    expect(prepareUpdate.steps[0]?.mapping).toEqual({ current: 'result.draft', changes: 'literal:{}' })
    expect(prepareUpdate.inputs).not.toHaveProperty('changes.typeCode')
    expect(prepareUpdate.inputs).not.toHaveProperty('changes.projectDomain')
    expect(contracts['technology-project-type-remove']?.steps[0]?.mapping).toEqual({ code: 'context.selectedTypeCode', name: 'context.selectedTypeName' })
    expect(contracts['technology-project-type-create']?.output.shape).toBe('undefined')
    expect(contracts['technology-project-type-list']?.output.fields.map(item => item.path)).toEqual([
      '$', 'list', 'list[]', 'list[].id', 'list[].typeCode', 'list[].codeAbbreviation', 'list[].roleCodes', 'list[].roleCodes[]', 'list[].typeName', 'list[].projectDomain', 'list[].status', 'list[].sort', 'list[].remark', 'list[].updateTime', 'total',
    ])
  })

  it('共享接线后真实describe、-llm、页面、方法和invoke均发布同一契约', async () => {
    const calls: InternalAxiosRequestConfig[] = []
    axios.defaults.adapter = async config => {
      calls.push(config)
      return { data: { ret: 'SUCCESS', data: { list: [row], total: 1 } }, status: 200, statusText: 'OK', headers: {}, config }
    }
    const sdk = createPortalHeadless({ baseUrl: 'https://portal.invalid', credential: { token: 'fixture', tenantId: 1 } })
    for (const definition of technologyProjectTypeCapabilities) {
      const described = sdk.catalog.describe(definition.id)
      const llm = sdk.catalog.describe(definition.id + '-llm')
      if (!described.ok || !llm.ok) throw new Error('项目类型能力尚未接入共享目录：' + definition.id)
      expect(described.ai).toEqual(contracts[definition.id])
      expect(llm.ai).toEqual(contracts[definition.id])
      expect(described.invoke?.sdkPath).toMatch(/^technologyProjectType\./)
    }
    for (const [path, contract] of Object.entries(methodContracts)) {
      const described = sdk.catalog.describeMethod(path)
      if (!described.ok) throw new Error('项目类型方法尚未接入共享目录：' + path)
      expect(described.ai).toEqual(contract)
    }
    const page = sdk.catalog.describePage('/dashboard/technology/setting/project-type/list')
    expect(page.ok).toBe(true)
    expect(JSON.stringify(page)).toContain('technology-project-type-remove')
    const result = await sdk.capabilities.invoke('technology-project-type-list-llm', { code: 'BIO-01' })
    expect(result).toEqual({ list: [{ id: row.id, typeCode: 'BIO-01', codeAbbreviation: 'bio1', roleCodes: ['project_owner', 'project_member'], typeName: '生物研发', projectDomain: 'biology', status: 0, sort: 1.5, remark: '测试', updateTime: '2026-09-22 09:00:00' }], total: 1 })
    expect(calls[0]?.baseURL).toBe('https://portal.invalid')
    expect(calls[0]?.url).toContain('/admin-api/technology/setting/project-type/page?')
    expect(calls[0]?.headers.get('module-type')).toBeUndefined()
  })
})
