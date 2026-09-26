import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  CONTRACT_CREATE_METHODS,
  CONTRACT_CREATE_MODULE_TYPE,
  CONTRACT_CREATE_PAGE_PATH,
  CONTRACT_CREATE_PERMISSION,
  contractCreateCapabilities,
  createContractCreateCapability,
} from '../src/capabilities/contract-create.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createContractCreateCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const content = JSON.stringify({ version: '1.1.0', blocks: [{ id: 'b1', name: 'Custom/Text', data: {} }] })

describe('Portal 风险防控 → 合同创建页面能力', () => {
  it('逐页锁定入口、表单、预览、模板选择和页面写入分支', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portal, 'app/portal/menus/hr.js')
    const list = read(portal, 'app/portal/views/dashboard/hr/contract/create/list.vue')
    const form = read(portal, 'app/portal/views/dashboard/hr/contract/[mode]/form/[id].vue')
    const preview = read(portal, 'app/portal/views/dashboard/hr/contract/[mode]/preview/share.js')
    const template = read(portal, 'app/portal/views/dashboard/hr/contract/[mode]/form/components/template-select/index.vue')
    expect(menu).toContain(`path: '${CONTRACT_CREATE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${CONTRACT_CREATE_PERMISSION}'`)
    for (const fragment of ['startContractCreate', "routerMethod: 'replace'", "callbackApi: '/admin-api/hr/contract/callback'"]) expect(list).toContain(fragment)
    for (const fragment of ['name:', 'typeId:', 'organizationId:', 'contractTemplateId:', 'required: true', 'formRef.value.validate()']) expect(form).toContain(fragment)
    for (const fragment of ["'/hr/contract-template/getEnableContractTemplate'", 'typeId:', 'useSystem: props.useSystem']) expect(template).toContain(fragment)
    for (const fragment of ['/hr/contract-template/get', '/hr/contract/createContractByCommon', 'onlySave', 'validateTemplateConfig', 'validateResolvedContent', 'callbackApi']) expect(preview).toContain(fragment)
    expect(contractCreateCapabilities.map(item => item.id)).toEqual(Object.keys(CONTRACT_CREATE_METHODS))
    expect(contractCreateCapabilities.every(item => item.pagePath === CONTRACT_CREATE_PAGE_PATH && item.permission === CONTRACT_CREATE_PERMISSION && item.moduleType === CONTRACT_CREATE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定 Java 创建请求、回执、模板过滤和内容校验', () => {
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const base = 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr'
    const controller = read(java, `${base}/controller/admin/riskcontrol/contract/ContractController.java`)
    const save = read(java, `${base}/controller/admin/riskcontrol/contract/vo/ContractSaveReqVO.java`)
    const response = read(java, `${base}/controller/admin/riskcontrol/contract/vo/ContractRespVO.java`)
    const validator = read(java, `${base}/service/contract/ContractContentValidator.java`)
    const templateController = read(java, `${base}/controller/admin/riskcontrol/contract/WorkflowContractTemplateController.java`)
    const service = read(java, `${base}/service/contract/ContractServiceImpl.java`)
    for (const fragment of ['createContractByCommon', '@PostMapping', 'callback']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long templateId', 'private Long typeId', 'private Long organizationId', 'private List<ContractDataSaveReqVO> dataList', 'private String content', 'private Integer onlySave', 'private String callbackApi']) expect(save).toContain(fragment)
    for (const fragment of ['private Long id', 'private String code', 'private Long contractVersionId', 'private Integer onlySave']) expect(response).toContain(fragment)
    for (const fragment of ['validateContractContent', '存在重复 block id', 'blocks', 'version']) expect(validator).toContain(fragment)
    for (const fragment of ['getEnableContractTemplate', 'typeId', 'useSystem']) expect(templateController).toContain(fragment)
    for (const fragment of ['createContractByCommon', 'getOnlySave()', 'setStatus', 'ContractContentValidator']) expect(service).toContain(fragment)
  })

  it('按Portal规则读取模板和变量，并保留创建请求的完整字段', async () => {
    const template = { id: 56, typeId: 21, name: '劳动合同', status: 1, content, useSystem: null }
    const f = fixture([[template], { id: 56, typeId: 21, name: '劳动合同', content, status: 1 }, [{ name: 'employee.name', value: '李四' }]])
    await expect(f.api.templateOptions({ typeId: 21 })).resolves.toMatchObject([{ id: 56, name: '劳动合同', typeId: 21, content }])
    await expect(f.api.template({ id: 56 })).resolves.toMatchObject({ id: 56, name: '劳动合同', content })
    await expect(f.api.variables({ variableApi: '/api/contract/variables', variableApiData: '{"businessId":7}' })).resolves.toEqual([{ name: 'employee.name', value: '李四' }])
    expect(f.calls).toEqual([
      { url: '/hr/contract-template/getEnableContractTemplate', method: 'get', params: { typeId: 21, useSystem: null } },
      { url: '/hr/contract-template/get', method: 'get', params: { id: 56 } },
      { url: '/api/contract/variables', method: 'get', params: { businessId: 7 } },
    ])
  })

  it('完整覆盖prepare → create → callback，并区分仅保存和创建并下载', async () => {
    const receipt = { id: 901, code: 'HT20260925001', contractVersionId: 902, onlySave: 1 }
    const f = fixture([receipt, true])
    const prepared = f.api.prepare({
      name: '劳动合同',
      typeId: 21,
      organizationId: 34,
      contractTemplateId: 56,
      content,
      variables: [{ name: ' employee.name ', value: '李四' }],
      onlySave: 1,
      businessId: null,
      featureId: null,
      useSystem: null,
      variableApi: '',
      variableApiData: '',
      callbackApiData: '{"source":"portal"}',
      callbackApiForSignAfterApi: '',
      callbackApiForSignAfterApiData: '',
    })
    expect(prepared.draft).toEqual({
      name: '劳动合同',
      templateId: 56,
      typeId: 21,
      code: null,
      organizationId: 34,
      dataList: [{ contractKey: ' employee.name ', contractValue: '李四' }],
      content,
      businessId: null,
      featureId: null,
      useSystem: null,
      onlySave: 1,
      variableApi: '',
      variableApiData: '',
      callbackApi: '',
      callbackApiData: '{"source":"portal"}',
      callbackApiForSignAfterApi: '',
      callbackApiForSignAfterApiData: '',
    })
    await expect(f.api.create({ draft: prepared.draft })).resolves.toEqual(receipt)
    await expect(f.api.callback({ receipt, onlySave: 1, callbackApi: '/admin-api/hr/contract/callback', callbackApiData: '{"source":"portal"}' })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/hr/contract/createContractByCommon', method: 'post', data: prepared.draft },
      { url: '/admin-api/hr/contract/callback', method: 'post', data: { source: 'portal', ...receipt, onlySave: 1 } },
    ])
  })

  it('拒绝动态接口的绝对地址、协议相对地址、反斜杠、编码绕过和非法协议', async () => {
    const f = fixture([])
    const valid = { name: '合同', typeId: 21, organizationId: 34, contractTemplateId: 56, content, onlySave: 0 as const }
    const validDraft = f.api.prepare(valid).draft
    const receipt = { id: 901, code: null, contractVersionId: 902, onlySave: 0 }
    const unsafeEndpoints = [
      'https://evil.example/collect',
      '//evil.example/collect',
      '/\\evil.example/collect',
      'javascript:alert(1)',
      'data:text/plain,evil',
      '%68%74%74%70%3a%2f%2f evil.example/collect',
      '/%2f%2fevil.example/collect',
      '/%5c%5cevil.example/collect',
      '/%252f%252fevil.example/collect',
    ]

    for (const endpoint of unsafeEndpoints) {
      await expect(f.api.variables({ variableApi: endpoint })).rejects.toThrow('variableApi')
      expect(() => f.api.prepare({ ...valid, variableApi: endpoint })).toThrow('variableApi')
      await expect(f.api.create({ draft: { ...validDraft, variableApi: endpoint } })).rejects.toThrow('draft.variableApi')
      await expect(f.api.create({ draft: { ...validDraft, callbackApi: endpoint } })).rejects.toThrow('draft.callbackApi')
      await expect(f.api.callback({ receipt, onlySave: 0, callbackApi: endpoint })).rejects.toThrow('callbackApi')
    }

    expect(() => f.api.prepare({ ...valid, variableApi: null, callbackApi: null })).not.toThrow()
    expect(f.api.prepare({ ...valid, variableApi: null, callbackApi: null }).draft).toMatchObject({ variableApi: '', callbackApi: '' })
    expect(f.calls).toHaveLength(0)
  })

  it('表单、内容、变量键和draft回传规则失败时不发请求', async () => {
    const f = fixture([])
    const valid = { name: '合同', typeId: 21, organizationId: 34, contractTemplateId: 56, content, onlySave: 0 as const }
    expect(() => f.api.prepare({ ...valid, name: '' })).toThrow('不能为空')
    expect(() => f.api.prepare({ ...valid, typeId: 0 })).toThrow('正整数ID')
    expect(() => f.api.prepare({ ...valid, content: '{"version":"1.1.0"}' })).toThrow('blocks')
    expect(() => f.api.prepare({ ...valid, variables: [{ name: 'x', value: '1' }, { name: ' x ', value: '2' }] })).toThrow('重复name')
    expect(() => f.api.prepare({ ...valid, onlySave: 2 as 0 })).toThrow('onlySave')
    await expect(f.api.create({ draft: { ...valid, templateId: 56, code: 'HT' as unknown as null, dataList: [], businessId: null, featureId: null, useSystem: null, variableApi: '', variableApiData: '', callbackApi: '', callbackApiData: '', callbackApiForSignAfterApi: '', callbackApiForSignAfterApiData: '' } })).rejects.toThrow('code必须为null')
    expect(f.calls).toHaveLength(0)
  })
})
