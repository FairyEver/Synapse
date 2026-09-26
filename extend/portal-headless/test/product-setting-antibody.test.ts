import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingAntibodyCapability,
  PRODUCT_SETTING_ANTIBODY_METHODS,
  PRODUCT_SETTING_ANTIBODY_MODULE_TYPE,
  PRODUCT_SETTING_ANTIBODY_PAGE_PATH,
  PRODUCT_SETTING_ANTIBODY_PERMISSION,
  productSettingAntibodyCapabilities,
} from '../src/capabilities/product-setting-antibody.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  PRODUCT_SETTING_ANTIBODY_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_ANTIBODY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-antibody.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: 'antibody-1',
  type: 1 as const,
  antibody: 'IBD',
  upLimit: 10,
  downLimit: 2,
  upProtectionRate: 0.75,
  downProtectionRate: 0.25,
  protectionValue: 0.5,
  evaluation: 1 as const,
  extension: 'keep-on-edit',
}

const createForm = {
  type: 1 as const,
  antibody: ' IBD ',
  upLimit: 10,
  downLimit: 2,
  upProtectionRate: 75,
  downProtectionRate: 25,
  protectionValue: 50,
  evaluation: -1 as const,
}

const updateForm = {
  ...row,
  type: 2 as const,
  antibody: 'IBD-更新',
  upProtectionRate: 80,
  downProtectionRate: 20,
  protectionValue: 60,
  evaluation: 0 as const,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingAntibodyCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function captureProduct () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { page: { list: [row], total: 1 } } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
    { baseUrls: { product: 'https://biz-api-test.wodecorp.cn/flockSimu' } },
  )
  const api = createProductSettingAntibodyCapability(
    config => call(PRODUCT_SETTING_ANTIBODY_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 标准库管理 → 抗体监测标准页面能力', () => {
  it('逐页锁定菜单、product实例、菜单权限、无独立query/submit权限和Java端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/antibody/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/standard-manage/antibody/modal-form-content.vue')
    const productHttp = read(portalRoot, 'app/portal/utils/http/product.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/AntibodyController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/standard/Antibody.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/standard/AntibodyMapperExt.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/AntibodyServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_ANTIBODY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_ANTIBODY_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "http.get('/base/antibody/page'",
      "http.post('/base/antibody/save'",
      'http.delete(`/base/antibody/${record.id}`)',
      "// query: 'base:antibody:query'",
      "// submit: 'base:antibody:submit'",
      'permissionCheck(permissions.submit)',
      'getDataListIsPage: true',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "{ label: '育成鸡', value: 1 }",
      "{ label: '产蛋鸡', value: 2 }",
      'type: [{ required: true',
      'antibody: [{ required: true',
      'evaluation: [{ required: true',
      'upLimit: formState.upLimit ?? 0',
      'downLimit: formState.downLimit ?? 0',
      'downProtectionRate: (formState.downProtectionRate ?? 0) / 100',
      'upProtectionRate: (formState.upProtectionRate ?? 0) / 100',
      'protectionValue: (formState.protectionValue ?? 0) / 100',
      '...props.raw',
    ]) expect(modal).toContain(fragment)
    for (const fragment of [
      "baseURL: import.meta.env.VITE_FM_API",
      "devicetype: 'PC'",
      'const keys = Object.keys(data)',
    ]) expect(productHttp).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("flockSimu/base/antibody")',
      '@GetMapping("page")',
      '@PostMapping("save")',
      '@DeleteMapping("{id}")',
      'PageParam.responsePage(resultList)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['Integer type', 'String antibody', 'BigDecimal upLimit', 'BigDecimal downLimit', 'BigDecimal upProtectionRate', 'BigDecimal downProtectionRate', 'BigDecimal protectionValue', 'Integer evaluation']) expect(entity).toContain(field)
    for (const fragment of [
      "AND antibody like concat(#{antibody},'%')",
      'AND evaluation = #{evaluation}',
      'del_flag = 0',
    ]) expect(mapper).toContain(fragment)
    for (const fragment of ['antibodyMapperExt.updateByPrimaryKeySelective(antibody)', 'antibodyMapperExt.insertSelective(antibody)', 'antibodyMapperExt.deleteById(id)', 'antibody.preUpdate()', 'antibody.preInsert()']) expect(service).toContain(fragment)

    expect(productSettingAntibodyCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_ANTIBODY_METHODS))
    expect(productSettingAntibodyCapabilities.every(item => item.pagePath === PRODUCT_SETTING_ANTIBODY_PAGE_PATH && item.permission === PRODUCT_SETTING_ANTIBODY_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_ANTIBODY_MODULE_TYPE)).toBe(true)
  })

  it('列表按Portal逐字段发送筛选、排序占位和styleV2分页，并兼容Java page包络', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ antibody: '抗体', evaluation: '1', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{
      url: '/base/antibody/page',
      method: 'get',
      params: { order: '', orderField: '', antibody: '抗体', evaluation: '1', pageNo: 2, pageSize: 50 },
    }])

    const defaults = fixture([[row]])
    await expect(defaults.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(defaults.calls[0]).toEqual({
      url: '/base/antibody/page',
      method: 'get',
      params: { order: '', orderField: '', antibody: '', evaluation: '', pageNo: 1, pageSize: 20 },
    })
  })

  it('新建和编辑复刻Portal必填、默认0、百分数转小数和raw扩展字段', async () => {
    const f = fixture([{}, {}])
    const preparedCreate = f.api.prepareCreate(createForm)
    expect(preparedCreate).toEqual({ draft: {
      type: 1,
      antibody: ' IBD ',
      upLimit: 10,
      downLimit: 2,
      upProtectionRate: 0.75,
      downProtectionRate: 0.25,
      protectionValue: 0.5,
      evaluation: -1,
    } })
    await expect(f.api.create(preparedCreate)).resolves.toBe(true)

    const preparedUpdate = f.api.prepareUpdate(updateForm)
    expect(preparedUpdate).toEqual({ draft: {
      ...updateForm,
      upProtectionRate: 0.8,
      downProtectionRate: 0.2,
      protectionValue: 0.6,
    } })
    await expect(f.api.update(preparedUpdate)).resolves.toBe(true)

    expect(f.calls).toEqual([
      { url: '/base/antibody/save', method: 'post', data: preparedCreate.draft },
      { url: '/base/antibody/save', method: 'post', data: preparedUpdate.draft },
    ])
  })

  it('删除按Portal路径执行，确认前只准备ID', async () => {
    const f = fixture([{}])
    expect(f.api.prepareRemove({ id: row.id })).toEqual({ id: row.id })
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/base/antibody/antibody-1', method: 'delete' }])
  })

  it('坏输入不会发请求，边界和坏响应不会静默降级', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...createForm, type: 3 as never })).toThrow('类型')
    expect(() => f.api.prepareCreate({ ...createForm, antibody: '   ' })).toThrow('抗体监测项目名')
    expect(() => f.api.prepareCreate({ ...createForm, evaluation: 2 as never })).toThrow('评价')
    expect(() => f.api.prepareCreate({ ...createForm, upProtectionRate: 10_000_001 })).toThrow('保护率起')
    expect(() => f.api.prepareUpdate({ ...updateForm, id: '' })).toThrow('ID')
    expect(() => f.api.prepareRemove({ id: '' })).toThrow('ID')
    await expect(f.api.list({ evaluation: '2' })).rejects.toThrow('评价筛选')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toEqual([])

    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ page: { list: [{ ...row, type: 3 }], total: 1 } }]).api.list()).rejects.toThrow('类型')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/base/antibody/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖公开方法、百分比单位、无独立按钮权限、写后回查并已注册', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_ANTIBODY_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_ANTIBODY_METHODS).map(method => `productSettingAntibody.${method}`).sort())
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['product-setting-antibody-prepare-create']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['draft.type', 'draft.antibody', 'draft.upProtectionRate', 'draft.evaluation']))
    expect(contracts['product-setting-antibody-prepare-create']?.output.fields.find(field => field.path === 'draft.upProtectionRate')?.unit).toBe('比例小数')
    expect(contracts['product-setting-antibody-update']?.steps[0]?.capabilityId).toBe('product-setting-antibody-list')
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-antibody-prepare-remove' && item.sdkPath === 'productSettingAntibody.prepareRemove')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'product-setting-antibody-remove' && item.sdkPath === 'productSettingAntibody.remove')).toBe(true)
    expect(contracts['product-setting-antibody-remove']?.boundaries.join('\n')).toContain('/base/antibody/{id}')
    expect(contracts['product-setting-antibody-list']?.boundaries.join('\n')).toContain('没有启用独立的base:antibody:query')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingAntibodyCapabilities, contracts })).toEqual([])
  })

  it('通用invoke把prepare表单映射到真实公开方法', async () => {
    const f = fixture([])
    const prepareCreate = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-antibody-prepare-create')
    const prepareUpdate = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-antibody-prepare-update')
    const prepareRemove = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-antibody-prepare-remove')
    const remove = CAPABILITY_BINDINGS.find(item => item.capabilityId === 'product-setting-antibody-remove')
    expect(prepareCreate).toBeDefined()
    expect(prepareUpdate).toBeDefined()
    expect(prepareRemove).toBeDefined()
    expect(remove).toBeDefined()
    await expect(prepareCreate!.run({ productSettingAntibody: f.api } as never, { form: createForm })).resolves.toEqual(f.api.prepareCreate(createForm))
    await expect(prepareUpdate!.run({ productSettingAntibody: f.api } as never, { form: updateForm })).resolves.toEqual(f.api.prepareUpdate(updateForm))
    await expect(prepareRemove!.run({ productSettingAntibody: f.api } as never, { id: row.id })).resolves.toEqual({ id: row.id })
    await expect(remove!.run({ productSettingAntibody: f.api } as never, { id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/base/antibody/antibody-1', method: 'delete' }])
  })
})
