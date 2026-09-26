import { describe, expect, it } from 'vitest'
import { resolveModuleType } from '../src/context/module-type.js'
import { createPageCall } from '../src/call.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'
import {
  createTechnologySettingTemplateBaseCapability,
  TECHNOLOGY_SETTING_TEMPLATE_BASE_MODULE_TYPE,
  TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH,
  TECHNOLOGY_SETTING_TEMPLATE_BASE_PERMISSION,
  TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS,
  technologySettingTemplateBaseCapabilities,
} from '../src/capabilities/technology-setting-template-base.js'
import {
  TECHNOLOGY_SETTING_TEMPLATE_BASE_CONTRACTS as contracts,
  TECHNOLOGY_SETTING_TEMPLATE_BASE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-technology-setting-template-base.js'

type RequestConfig = Parameters<PortalRequest>[0]

const itemRow = {
  id: '1001',
  itemCode: 'FIELD-01',
  itemName: '试验指标',
  itemType: 'field',
  projectDomainCodes: 'engineering,biology',
  mustSelect: true,
  status: 0,
  remark: '原备注',
  updateTime: '2026-09-24 10:00:00',
  creator: 'server-extension',
}

const nodeChild = {
  id: 2002,
  nodeCode: 'CHILD',
  nodeName: '子节点',
  projectDomain: 'biology',
  parentId: 2001,
  sort: 1,
  status: 0,
  remark: null,
  path: 'ROOT/CHILD',
  leaf: true,
  depth: 2,
  serverExtension: 'preserve-me',
}

const nodeRow = {
  id: 2001,
  nodeCode: 'ROOT',
  nodeName: '根节点',
  projectDomain: 'biology',
  parentId: null,
  sort: 0,
  status: 0,
  remark: '节点备注',
  path: 'ROOT',
  leaf: false,
  depth: 1,
  children: [nodeChild],
  serverExtension: 'preserve-me',
}

function setup (...responses: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createTechnologySettingTemplateBaseCapability(request), calls }
}

describe('模板基础配置 capability', () => {
  it('逐个动作锁定页面、权限、platform实例和module-type缺省行为', async () => {
    expect(technologySettingTemplateBaseCapabilities.map(item => item.id)).toEqual(Object.keys(TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS))
    expect(technologySettingTemplateBaseCapabilities.every(item =>
      item.pagePath === TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH
      && item.permission === TECHNOLOGY_SETTING_TEMPLATE_BASE_PERMISSION
      && item.httpInstance === 'platform'
      && item.moduleType === TECHNOLOGY_SETTING_TEMPLATE_BASE_MODULE_TYPE
    )).toBe(true)
    expect(resolveModuleType(TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH)).toEqual({
      moduleType: null,
      label: null,
      matchedBy: 'none',
    })

    const captured: RequestConfig[] = []
    const request: PortalRequest = async <T>(config: RequestConfig) => {
      captured.push(config)
      return { list: [], total: 0 } as T
    }
    const call = createPageCall(request)
    const api = createTechnologySettingTemplateBaseCapability(config =>
      call(TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH, { ...config, httpInstance: 'platform' }),
    )
    await api.itemList()
    expect(captured[0]).not.toHaveProperty('moduleType')
    expect(captured[0]).not.toHaveProperty('headers')
  })

  it('配置项列表逐字段发送Portal查询，不擅自添加order或全量参数', async () => {
    const { api, calls } = setup({ list: [itemRow], total: 7 })
    await expect(api.itemList({
      pageNo: 2,
      pageSize: 50,
      code: 'FIELD',
      name: '指标',
      projectDomain: 'biology',
      itemType: 'field',
    })).resolves.toEqual({
      list: [{
        id: '1001',
        itemCode: 'FIELD-01',
        itemName: '试验指标',
        itemType: 'field',
        projectDomainCodes: 'engineering,biology',
        mustSelect: true,
        status: 0,
        remark: '原备注',
        updateTime: '2026-09-24 10:00:00',
      }],
      total: 7,
    })
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-item/page',
      method: 'get',
      params: {
        pageNo: 2,
        pageSize: 50,
        code: 'FIELD',
        name: '指标',
        projectDomain: 'biology',
        itemType: 'field',
      },
    })
    expect(calls[0]?.params).not.toHaveProperty('order')
    expect(calls[0]?.params).not.toHaveProperty('orderField')
  })

  it('编辑器配置项候选使用simple-list并只校验页面实际消费字段', async () => {
    const option = {
      id: '1001', itemCode: 'FIELD-01', itemName: '试验指标', itemType: 'field', mustSelect: true,
      projectDomainCodes: 'biology', ignoredBackendField: 'preserved',
    }
    const { api, calls } = setup([option])
    await expect(api.itemSimpleList({ projectDomain: 'biology', status: 0 })).resolves.toEqual([option])
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-item/simple-list', method: 'get',
      params: { projectDomain: 'biology', status: 0 },
    })
    await expect(setup({}).api.itemSimpleList({ projectDomain: 'biology' })).rejects.toThrow('必须为数组')
  })

  it('配置项新增按页面规则排序多选值并发送显式id=null', async () => {
    const { api, calls } = setup({})
    const prepared = api.prepareItemCreate({
      itemCode: 'FIELD-02',
      itemName: '新指标',
      itemType: 'field',
      domainValues: ['engineering', 'biology'],
      mustSelect: false,
      status: 0,
      remark: '',
    })
    expect(prepared).toEqual({
      draft: {
        id: null,
        itemCode: 'FIELD-02',
        itemName: '新指标',
        itemType: 'field',
        projectDomainCodes: 'biology,engineering',
        mustSelect: false,
        status: 0,
        remark: '',
      },
    })
    await expect(api.itemCreate(prepared)).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-item/create',
      method: 'post',
      data: prepared.draft,
    })
  })

  it('配置项编辑锁定itemCode并按domainValues映射，反证不能把编码或逗号字段偷换进请求', async () => {
    const { api, calls } = setup({})
    const prepared = api.prepareItemUpdate({
      current: itemRow,
      changes: {
        itemName: '新指标名',
        domainValues: ['engineering', 'biology'],
        itemCode: 'HACKED-CODE',
        projectDomainCodes: 'information',
      } as never,
    })
    expect(prepared.previous).toEqual({
      id: '1001',
      itemCode: 'FIELD-01',
      itemName: '试验指标',
      itemType: 'field',
      projectDomainCodes: 'biology,engineering',
      mustSelect: true,
      status: 0,
      remark: '原备注',
    })
    expect(prepared.draft).toEqual({
      ...prepared.previous,
      itemName: '新指标名',
    })
    await expect(api.itemUpdate(prepared)).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-item/update',
      method: 'put',
      data: prepared.draft,
    })
    expect(calls[0]?.data).not.toHaveProperty('projectDomainCodes', 'information')
    expect((calls[0]?.data as Record<string, unknown>).itemCode).toBe('FIELD-01')
    expect((calls[0]?.data as Record<string, unknown>).id).toBe('1001')
  })

  it('配置项表单必填、枚举、多选、状态和布尔规则在请求前拦截', async () => {
    const { api, calls } = setup()
    for (const value of [
      { itemCode: 'CODE', itemName: ' ', itemType: 'field', domainValues: ['biology'] },
      { itemCode: 'CODE', itemName: '名称', itemType: 'other', domainValues: ['biology'] },
      { itemCode: 'CODE', itemName: '名称', itemType: 'field', domainValues: [] },
      { itemCode: 'CODE', itemName: '名称', itemType: 'field', domainValues: ['biology', 'biology'] },
      { itemCode: 'CODE', itemName: '名称', itemType: 'field', domainValues: ['other'] },
      { itemCode: 'CODE', itemName: '名称', itemType: 'field', domainValues: ['biology'], status: 2 },
      { itemCode: 'CODE', itemName: '名称', itemType: 'field', domainValues: ['biology'], mustSelect: 'yes' },
    ]) expect(() => api.prepareItemCreate(value as never)).toThrow()
    expect(() => api.prepareItemCreate({
      itemCode: ' ',
      itemName: '名称',
      itemType: 'field',
      domainValues: ['biology'],
    })).toThrow()
    expect(calls).toHaveLength(0)
  })

  it('配置项删除只使用当前行id，错误回执不吞掉', async () => {
    const ok = setup({})
    expect(ok.api.prepareItemRemove(itemRow)).toEqual({ id: '1001' })
    await expect(ok.api.itemRemove({ id: '1001' })).resolves.toBeUndefined()
    expect(ok.calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-item/delete',
      method: 'delete',
      params: { id: '1001' },
    })

    const failed = setup(new Error('配置项已被模板引用'))
    await expect(failed.api.itemRemove('1001')).rejects.toThrow('已被模板引用')
  })

  it('节点树逐项保留Portal展示字段和编辑spread所需扩展字段', async () => {
    const { api, calls } = setup([nodeRow])
    await expect(api.nodeList({ projectDomain: 'biology' })).resolves.toEqual([{
      ...nodeRow,
      children: [nodeChild],
    }])
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-node/tree',
      method: 'get',
      params: { projectDomain: 'biology' },
    })
    const defaulted = setup([])
    await defaulted.api.nodeList()
    expect(defaulted.calls[0]?.params).toEqual({ projectDomain: 'biology' })
  })

  it('节点新增把根节点空父级映射为0并发送页面字段', async () => {
    const { api, calls } = setup({})
    const prepared = api.prepareNodeCreate({
      nodeCode: 'ROOT-2',
      nodeName: '新根节点',
      projectDomain: 'information',
      parentId: null,
      sort: 0,
      status: 0,
      remark: '',
    })
    expect(prepared).toEqual({
      draft: {
        nodeCode: 'ROOT-2',
        nodeName: '新根节点',
        projectDomain: 'information',
        parentId: 0,
        sort: 0,
        status: 0,
        remark: '',
      },
    })
    await expect(api.nodeCreate(prepared)).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-node/create',
      method: 'post',
      data: { id: null, ...prepared.draft },
    })
  })

  it('节点编辑锁定nodeCode/projectDomain，保留children等原行扩展字段', async () => {
    const { api, calls } = setup({})
    const prepared = api.prepareNodeUpdate({
      current: nodeRow,
      changes: {
        nodeName: '根节点改名',
        parentId: 0,
        nodeCode: 'HACKED-CODE',
        projectDomain: 'engineering',
      } as never,
    })
    expect(prepared.draft).toMatchObject({
      id: 2001,
      nodeCode: 'ROOT',
      nodeName: '根节点改名',
      projectDomain: 'biology',
      parentId: 0,
      children: [nodeChild],
      path: 'ROOT',
      leaf: false,
      depth: 1,
      serverExtension: 'preserve-me',
    })
    await expect(api.nodeUpdate(prepared)).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-node/update',
      method: 'put',
      data: prepared.draft,
    })
    expect((calls[0]?.data as Record<string, unknown>).nodeCode).toBe('ROOT')
    expect((calls[0]?.data as Record<string, unknown>).projectDomain).toBe('biology')
  })

  it('节点删除按ID执行，坏树响应和后端错误均保持失败', async () => {
    const ok = setup({})
    expect(ok.api.prepareNodeRemove(nodeRow)).toEqual({ id: 2001 })
    await expect(ok.api.nodeRemove(2001)).resolves.toBeUndefined()
    expect(ok.calls[0]).toEqual({
      url: '/admin-api/technology/setting/template-node/delete',
      method: 'delete',
      params: { id: 2001 },
    })

    const badResponse = setup({ id: 1 })
    await expect(badResponse.api.nodeList()).rejects.toThrow('必须为数组')
    const failed = setup(new Error('节点存在子节点'))
    await expect(failed.api.nodeRemove(2001)).rejects.toThrow('存在子节点')
  })
})

describe('模板基础配置 AI contract', () => {
  it('14个动作都有结构化说明，关键映射和缺口保持可见', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(Object.keys(contracts)).toEqual(Object.keys(TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS))
    expect(validateAiContracts(contracts, {
      definitions: technologySettingTemplateBaseCapabilities,
      contracts,
    })).toEqual([])
    expect(Object.keys(methodContracts)).toEqual(Object.values(TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS).map(method => 'technologySettingTemplateBase.' + method))
    expect(contracts['technology-setting-template-base-item-prepare-create']?.steps[0]?.mapping).toMatchObject({
      domainValues: 'result.draft.projectDomainCodes',
    })
    expect(contracts['technology-setting-template-base-item-prepare-update']?.inputs).not.toHaveProperty('changes.itemCode')
    expect(contracts['technology-setting-template-base-node-prepare-update']?.inputs).not.toHaveProperty('changes.nodeCode')
    for (const contract of Object.values(contracts)) {
      expect(contract.gaps?.join(' ')).toContain('未执行浏览器基准')
      expect(contract.gaps?.join(' ')).toContain('Java')
    }
  })
})
