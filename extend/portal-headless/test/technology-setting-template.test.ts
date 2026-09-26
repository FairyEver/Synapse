import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import {
  createTechnologySettingTemplateCapability,
  TECHNOLOGY_SETTING_TEMPLATE_METHODS,
  TECHNOLOGY_SETTING_TEMPLATE_MODULE_TYPE,
  TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH,
  TECHNOLOGY_SETTING_TEMPLATE_PERMISSION,
  technologySettingTemplateCapabilities,
} from '../src/capabilities/technology-setting-template.js'
import {
  TECHNOLOGY_SETTING_TEMPLATE_AI_CONTRACTS as contracts,
  TECHNOLOGY_SETTING_TEMPLATE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-technology-setting-template.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

const templateRow = {
  id: '1001',
  templateCode: 'TPL-BIO-01',
  templateName: '生物模板',
  projectDomain: 'biology',
  status: 0,
  remark: '模板备注',
  updateTime: '2026-09-25 09:00:00',
  ignoredBackendField: 'not consumed by this page',
}
const versionRow = {
  id: '2001',
  versionNo: '1.0',
  versionName: '初始版本',
  versionStatus: 'draft',
  publishTime: null,
  ignoredBackendField: 'not consumed by this page',
}
const versionConfig = {
  templateVersionId: '2001',
  templateName: '生物模板',
  projectDomain: 'biology',
  versionNo: '1.0',
  versionName: '初始版本',
  versionStatus: 'draft',
  editable: true,
  updateTime: '2026-09-25 09:10:00',
  nodes: [{
    sourceNodeId: '3001',
    parentSourceNodeId: null,
    sort: 0,
    nodeName: '基本信息',
    items: [{ templateItemId: '4001', displayName: '名称', isRequired: 1, sort: 0, itemType: 'field' }],
    children: [],
  }],
  ignoredBackendField: 'preserved for editor consumption',
}
const versionConfigNode = versionConfig.nodes[0]!

function setup(...responses: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response as T
  }
  return { api: createTechnologySettingTemplateCapability(request), calls }
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Portal 科技设置 → 模板中心', () => {
  it('逐行锁定页面路径、权限、实例、module-type和页面动作边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const list = read(portalRoot, 'app/portal/views/dashboard/technology/setting/template/list.vue')
    const shared = read(portalRoot, 'app/portal/views/dashboard/technology/setting/shared.js')
    const menu = read(portalRoot, 'app/portal/menus/technology.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/technology/setting/template.vue')
    const editor = read(portalRoot, 'app/portal/views/dashboard/technology/setting/template/editor/[id].vue')

    expect(menu).toContain(`path: '${TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${TECHNOLOGY_SETTING_TEMPLATE_PERMISSION}'`)
    expect(route).toContain(`permission: ${TECHNOLOGY_SETTING_TEMPLATE_PERMISSION}`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "getTemplatePage: (params) => http.get('/admin-api/technology/setting/template/page', { params })",
      "saveTemplate: (data) =>",
      "deleteTemplate: (id) => http.delete('/admin-api/technology/setting/template/delete', { params: { id } })",
      "getVersionPage: (params) => http.get('/admin-api/technology/setting/template/version/page', { params })",
      "createVersion: (data) => http.post('/admin-api/technology/setting/template/version/create', data)",
      "copyVersion: (data) => http.post('/admin-api/technology/setting/template/version/copy', data)",
      "publishVersion: (id) => http.post('/admin-api/technology/setting/template/version/publish', null, { params: { id } })",
      "disableVersion: (id) => http.put('/admin-api/technology/setting/template/version/disable', null, { params: { id } })",
      'getVersionConfig: (templateVersionId) =>',
      "saveVersionConfig: (data) => http.put('/admin-api/technology/setting/template/version/config', data)",
      'getVersionPage({ templateId: record.id, pageNo: 1, pageSize: 500 })',
      'data.total === data.list.length && drafts.length === 1',
      'templateFormRef.value.validate()',
      'versionFormRef.value.validate()',
      "router.push(`/dashboard/technology/setting/template/editor/${version.id}`)",
      "v-if=\"record.versionStatus === 'draft'\"",
      "v-if=\"record.versionStatus === 'published'\"",
    ]) expect(list.includes(fragment) || shared.includes(fragment) || editor.includes(fragment)).toBe(true)
    expect(editor).toContain('settingApi.getVersionConfig(route.params.id)')
    expect(editor).toContain('settingApi.saveVersionConfig({')
    expect(editor).toContain('await persistConfig()')
    expect(shared).toContain("getNodeTree: (params) => http.get('/admin-api/technology/setting/template-node/tree', { params })")
    expect(shared).toContain("getItems: (params) => http.get('/admin-api/technology/setting/template-item/simple-list', { params })")
    expect(list).not.toContain('<a-tabs')
    expect(list).not.toMatch(/common-action-(?:import|export|upload|download)/)
    expect(technologySettingTemplateCapabilities.map(item => item.id)).toEqual(Object.keys(TECHNOLOGY_SETTING_TEMPLATE_METHODS))
    expect(technologySettingTemplateCapabilities.every(item =>
      item.pagePath === TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH &&
      item.permission === TECHNOLOGY_SETTING_TEMPLATE_PERMISSION &&
      item.moduleType === TECHNOLOGY_SETTING_TEMPLATE_MODULE_TYPE &&
      item.httpInstance === 'platform',
    )).toBe(true)
    expect(resolveModuleType(TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH).moduleType).toBeNull()
  })

  it('列表逐字段发送Portal筛选参数并丢弃页面未消费的后端扩展字段', async () => {
    const { api, calls } = setup({ list: [templateRow], total: 7 }, { list: [], total: 0 })
    await expect(api.list({ pageNo: 2, pageSize: 50, code: 'TPL', name: '生物', projectDomain: 'biology' })).resolves.toEqual({
      list: [{
        id: '1001', templateCode: 'TPL-BIO-01', templateName: '生物模板', projectDomain: 'biology', status: 0,
        remark: '模板备注', updateTime: '2026-09-25 09:00:00',
      }],
      total: 7,
    })
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template/page', method: 'get',
      params: { pageNo: 2, pageSize: 50, code: 'TPL', name: '生物', projectDomain: 'biology' },
    })
    expect(calls[0]?.params).not.toHaveProperty('order')
    expect(calls[0]?.params).not.toHaveProperty('orderField')
    expect((await api.list()).list).toEqual([])
  })

  it('列表默认值与分页/响应校验和页面一致', async () => {
    const empty = setup({ list: [], total: 0 })
    await expect(empty.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(empty.calls[0]?.params).toEqual({ pageNo: 1, pageSize: 20, code: null, name: null, projectDomain: null })
    const invalid = setup()
    for (const query of [{ pageNo: 0 }, { pageSize: -1 }, { projectDomain: 'other' }]) {
      await expect(invalid.api.list(query as never)).rejects.toThrow()
    }
    await expect(setup({ list: [], total: -1 }).api.list()).rejects.toThrow('分页响应')
    expect(invalid.calls).toHaveLength(0)
  })

  it('新建准备只整理两步草稿，模板create不错误要求版本字段且请求体严格分离', async () => {
    const { api, calls } = setup('1001')
    const prepared = api.prepareCreate({
      templateCode: 'TPL-BIO-02', templateName: '新生物模板', projectDomain: 'biology', versionNo: '1.0', versionName: '初始版本',
    })
    expect(prepared).toEqual({ draft: {
      template: { id: null, templateCode: 'TPL-BIO-02', templateName: '新生物模板', projectDomain: 'biology', status: 0, remark: '' },
      initialVersion: { versionNo: '1.0', versionName: '初始版本' },
    } })
    await expect(api.create(prepared.draft.template)).resolves.toBe('1001')
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template/create', method: 'post',
      data: { id: null, templateCode: 'TPL-BIO-02', templateName: '新生物模板', projectDomain: 'biology', status: 0, remark: '' },
    })
    expect(calls[0]?.data).not.toHaveProperty('versionNo')
    expect(calls[0]?.data).not.toHaveProperty('versionName')
  })

  it('编辑只允许模板名称、状态、备注，保留锁定字段并发送完整PUT快照', async () => {
    const { api, calls } = setup(true)
    const prepared = api.prepareUpdate({ current: templateRow, changes: { templateName: '新名称', status: 1, remark: null } })
    expect(prepared.previous).toEqual({ id: '1001', templateCode: 'TPL-BIO-01', templateName: '生物模板', projectDomain: 'biology', status: 0, remark: '模板备注' })
    expect(prepared.draft).toEqual({ id: '1001', templateCode: 'TPL-BIO-01', templateName: '新名称', projectDomain: 'biology', status: 1, remark: null })
    await expect(api.update({ current: prepared.draft })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template/update', method: 'put',
      data: { id: '1001', templateCode: 'TPL-BIO-01', templateName: '新名称', projectDomain: 'biology', status: 1, remark: null },
    })
    expect(() => api.prepareUpdate({ current: templateRow, changes: { templateCode: 'HACK' } as never })).toThrow('不支持字段templateCode')
    expect(() => api.prepareUpdate({ current: templateRow, changes: { projectDomain: 'engineering' } as never })).toThrow('不支持字段projectDomain')
  })

  it('删除只发送模板族ID，空回执不伪造成业务数据，错误原样传播', async () => {
    const ok = setup(true)
    await expect(ok.api.remove('1001')).resolves.toBeUndefined()
    expect(ok.calls[0]).toEqual({ url: '/admin-api/technology/setting/template/delete', method: 'delete', params: { id: '1001' } })
    const denied = setup(new Error('已有版本时不能删除'))
    await expect(denied.api.remove(1001)).rejects.toThrow('已有版本')
    for (const id of [0, -1, '', '01', 'abc', Number.MAX_SAFE_INTEGER + 1]) await expect(setup().api.remove(id)).rejects.toThrow('id')
  })

  it('版本列表固定请求第一页500条，版本行只返回页面字段', async () => {
    const { api, calls } = setup({ list: [versionRow], total: 1 })
    await expect(api.listVersions({ templateId: '1001' })).resolves.toEqual({
      list: [{ id: '2001', versionNo: '1.0', versionName: '初始版本', versionStatus: 'draft', publishTime: null }], total: 1,
    })
    expect(calls[0]).toEqual({
      url: '/admin-api/technology/setting/template/version/page', method: 'get',
      params: { templateId: '1001', pageNo: 1, pageSize: 500 },
    })
    expect(calls[0]?.params).not.toHaveProperty('order')
    expect(calls[0]?.params).not.toHaveProperty('pageSize', 20)
  })

  it('配置编辑器读取版本配置并按Portal的扁平节点结构保存，丢弃编辑器展示字段', async () => {
    const f = setup(versionConfig, { ...versionConfig, updateTime: '2026-09-25 09:11:00' })
    await expect(f.api.getVersionConfig('2001')).resolves.toEqual({
      ...versionConfig,
      nodes: [{
        ...versionConfigNode,
        items: [{ ...versionConfigNode.items[0]!, isRequired: true }],
      }],
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/technology/setting/template/version/config', method: 'get', params: { templateVersionId: '2001' },
    })
    const nodes = [{
      sourceNodeId: '3001', parentSourceNodeId: null, sort: 0, children: [],
      nodeName: '展示名称不应提交',
      items: [{ templateItemId: '4001', displayName: '显示名称', isRequired: false, sort: 0, itemType: 'field' }],
    }]
    expect(f.api.prepareVersionConfigSave({ templateVersionId: '2001', nodes })).toEqual({
      draft: {
        templateVersionId: '2001',
        nodes: [{ sourceNodeId: '3001', parentSourceNodeId: null, sort: 0, items: [{ templateItemId: '4001', displayName: '显示名称', isRequired: false, sort: 0 }] }],
      },
    })
    await expect(f.api.saveVersionConfig({ templateVersionId: '2001', nodes })).resolves.toEqual({
      ...versionConfig,
      updateTime: '2026-09-25 09:11:00',
      nodes: [{
        ...versionConfigNode,
        items: [{ ...versionConfigNode.items[0]!, isRequired: true }],
      }],
    })
    expect(f.calls[1]).toEqual({
      url: '/admin-api/technology/setting/template/version/config', method: 'put',
      data: {
        templateVersionId: '2001',
        nodes: [{ sourceNodeId: '3001', parentSourceNodeId: null, sort: 0, items: [{ templateItemId: '4001', displayName: '显示名称', isRequired: false, sort: 0 }] }],
      },
    })
    expect(f.calls[1]?.data?.nodes[0]).not.toHaveProperty('nodeName')
    expect(f.calls[1]?.data?.nodes[0]?.items[0]).not.toHaveProperty('itemType')
    await expect(setup().api.getVersionConfig(0)).rejects.toThrow('templateVersionId')
    expect(() => f.api.prepareVersionConfigSave({ templateVersionId: '2001', nodes: [{ ...nodes[0]!, items: [{ ...nodes[0]!.items[0]!, displayName: 1 }] }] as never })).toThrow('displayName')
  })

  it('初始版本、新建版本、复制版本分别锁定Portal请求体和端点', async () => {
    const f = setup('2001', '2002', '2003')
    expect(f.api.prepareInitialVersion({ templateId: '1001', versionNo: '1.0', versionName: '初始版本' })).toEqual({ draft: { templateId: '1001', versionNo: '1.0', versionName: '初始版本' } })
    await expect(f.api.createInitialVersion({ templateId: '1001', versionNo: '1.0', versionName: '初始版本' })).resolves.toBe('2001')
    expect(f.calls[0]).toEqual({ url: '/admin-api/technology/setting/template/version/create', method: 'post', data: { templateId: '1001', versionNo: '1.0', versionName: '初始版本' } })
    expect(f.calls[0]?.data).not.toHaveProperty('sourceVersionId')
    expect(f.calls[0]?.data).not.toHaveProperty('remark')
    await expect(f.api.createVersion({ templateId: '1001', sourceVersionId: null, versionNo: '1.1', versionName: '新草稿', remark: '' })).resolves.toBe('2002')
    expect(f.calls[1]).toEqual({ url: '/admin-api/technology/setting/template/version/create', method: 'post', data: { templateId: '1001', sourceVersionId: null, versionNo: '1.1', versionName: '新草稿', remark: '' } })
    await expect(f.api.copyVersion({ templateId: '1001', sourceVersionId: '2001', versionNo: '1.0-copy', versionName: '初始版本（副本）', remark: '复制自 1.0' })).resolves.toBe('2003')
    expect(f.calls[2]).toEqual({ url: '/admin-api/technology/setting/template/version/copy', method: 'post', data: { templateId: '1001', sourceVersionId: '2001', versionNo: '1.0-copy', versionName: '初始版本（副本）', remark: '复制自 1.0' } })
  })

  it('版本状态按钮按页面绝对状态门禁，并锁定publish/disable的空data和query id', async () => {
    const f = setup(true, true)
    await expect(f.api.publishVersion({ id: '2001', currentStatus: 'draft' })).resolves.toBeUndefined()
    expect(f.calls[0]).toEqual({ url: '/admin-api/technology/setting/template/version/publish', method: 'post', params: { id: '2001' }, data: null })
    await expect(f.api.disableVersion({ id: '2002', currentStatus: 'published' })).resolves.toBeUndefined()
    expect(f.calls[1]).toEqual({ url: '/admin-api/technology/setting/template/version/disable', method: 'put', params: { id: '2002' }, data: null })
    const blocked = setup()
    await expect(blocked.api.publishVersion({ id: '2001', currentStatus: 'published' })).rejects.toThrow('草稿')
    await expect(blocked.api.disableVersion({ id: '2002', currentStatus: 'draft' })).rejects.toThrow('已发布')
    expect(blocked.calls).toHaveLength(0)
  })

  it('表单校验、响应校验和网络错误在请求前/原样失败', async () => {
    const f = setup('2004')
    for (const input of [
      { templateCode: ' ', templateName: '模板', projectDomain: 'biology' },
      { templateCode: 'TPL', templateName: ' ', projectDomain: 'biology' },
      { templateCode: 'TPL', templateName: '模板', projectDomain: 'other' },
    ]) await expect(f.api.create(input as never)).rejects.toThrow()
    for (const input of [
      { templateId: '1001', versionNo: ' ', versionName: '首版' },
      { templateId: '1001', versionNo: '1.0', versionName: 'x'.repeat(101) },
    ]) await expect(f.api.createInitialVersion(input)).rejects.toThrow()
    await expect(f.api.createVersion({ templateId: '1001', sourceVersionId: null, versionNo: '1.1', versionName: '草稿', remark: null })).resolves.toBe('2004')
    expect(f.calls).toHaveLength(1)
    const denied = setup(new Error('模板中心无权限'))
    await expect(denied.api.list()).rejects.toThrow('无权限')
  })
})

describe('模板中心 AI contract', () => {
  it('覆盖全部能力、公开方法和结构校验；真实环境缺口显式保留', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(TECHNOLOGY_SETTING_TEMPLATE_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(TECHNOLOGY_SETTING_TEMPLATE_METHODS).map(method => `technologySettingTemplate.${method}`).sort())
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: technologySettingTemplateCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: technologySettingTemplateCapabilities, contracts }) as Array<{ code: string }>
    expect(complete.map(issue => issue.code)).toEqual(Array(Object.keys(contracts).length).fill('incomplete-evidence'))
    for (const contract of Object.values(contracts)) {
      expect(contract.gaps?.join(' ')).toContain('未启动浏览器')
      expect(contract.boundaries.join(' ')).toContain('没有tabs组件')
    }
  })

  it('关键映射反证锁住模板/首版分两步、编辑锁定字段和状态动作', () => {
    expect(contracts['technology-setting-template-prepare-create']?.steps[0]?.mapping).toEqual({
      templateCode: 'result.draft.template.templateCode',
      templateName: 'result.draft.template.templateName',
      projectDomain: 'result.draft.template.projectDomain',
      status: 'result.draft.template.status',
      remark: 'result.draft.template.remark',
    })
    expect(contracts['technology-setting-template-prepare-create']?.steps[0]?.mapping).not.toEqual({
      templateCode: 'result.draft.initialVersion.versionNo',
      templateName: 'result.draft.initialVersion.versionName',
    })
    expect(contracts['technology-setting-template-prepare-update']?.inputs).not.toHaveProperty('changes.templateCode')
    expect(contracts['technology-setting-template-prepare-update']?.inputs).not.toHaveProperty('changes.projectDomain')
    expect(contracts['technology-setting-template-version-publish']?.inputs.currentStatus?.options).toEqual([
      { value: 'draft', label: '草稿' }, { value: 'published', label: '已发布' }, { value: 'disabled', label: '已停用' },
    ])
    expect(contracts['technology-setting-template-list']?.output.fields.map(item => item.path)).toEqual([
      '$', 'list', 'list[]', 'list[].id', 'list[].templateCode', 'list[].templateName', 'list[].projectDomain', 'list[].status', 'list[].remark', 'list[].updateTime', 'total',
    ])
  })
})
