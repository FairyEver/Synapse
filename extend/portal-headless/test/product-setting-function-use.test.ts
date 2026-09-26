import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingFunctionUseCapability,
  PRODUCT_SETTING_FUNCTION_USE_METHODS,
  PRODUCT_SETTING_FUNCTION_USE_MODULE_TYPE,
  PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH,
  PRODUCT_SETTING_FUNCTION_USE_PERMISSION,
  PRODUCT_SETTING_FUNCTION_USE_QUERY_PERMISSION,
  PRODUCT_SETTING_FUNCTION_USE_SUBMIT_PERMISSION,
  productSettingFunctionUseCapabilities,
} from '../src/capabilities/product-setting-function-use.js'
import { PRODUCT_SETTING_FUNCTION_USE_AI_CONTRACTS as contracts, PRODUCT_SETTING_FUNCTION_USE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-setting-function-use.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: null,
  functionCode: 'demo.function',
  functionName: '演示功能',
  remarks: '测试备注',
  status: 0 as const,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingFunctionUseCapability(request), calls }
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
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [row] } },
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
  const api = createProductSettingFunctionUseCapability(
    config => call(PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 功能开关页面能力', () => {
  it('逐页锁定菜单、页面权限、提交权限、请求规则和Java null-id分支', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/function-use.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/function-use/list.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/sys/TenantFunctionUseController.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/sys/impl/TenantFunctionUseServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/sys/TenantFunctionUseMapperExt.xml')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/sys/TenantFunctionUse.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_FUNCTION_USE_PERMISSION}'`)
    expect(route).toContain('title: 功能开关')
    expect(route).toContain(PRODUCT_SETTING_FUNCTION_USE_PERMISSION)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "import { useListPageView } from 'common/libs/renren/list-ui.js'",
      "import { useListPageModule, listActionColumnWidth } from 'common/libs/renren/list.js'",
      "query: 'management:function-use:query'",
      "submit: 'management:function-use:submit'",
      'form: {}',
      "url: '/config/functionUse/list'",
      'idKey: \'functionCode\'',
      'getDataListIsPage: false',
      'permissionCheck(permissions.submit)',
      "url: '/config/functionUse/openOrClose'",
      'id: record.id',
      'functionCode: record.functionCode',
      'functionName: record.functionName',
      'status: Number(!record.status)',
      'rrList.actionFetch()',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'const params = {',
      'order: orderType.value',
      'orderField: orderField.value',
      'if (getDataListIsPage)',
    ]) expect(renrenList).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/config/functionUse")',
      '@GetMapping("list")',
      'getListByQuery(HRUserUtils.getUser().getTenantId(), isManager)',
      '@GetMapping("openOrClose")',
      '@RequestParam(required = false) String id',
      '@RequestParam(required = false) String functionCode',
      '@RequestParam(required = false) Integer status',
      'StringUtils.isBlank(functionCode) || status == null',
    ]) expect(controller).toContain(fragment)
    for (const fragment of [
      'selectByQuery(0L, null, 0)',
      'functionUseMapperExt.selectByQuery(HRUserUtils.getUser().getTenantId(), functionUse.getFunctionCode(), null)',
      'functionUse.setId(null)',
      'functionUse.setStatus(0)',
      'if(StringUtils.isNotBlank(id))',
      'functionUseMapperExt.updateStatusById(id, status)',
      'new TenantFunctionUse(null, functionCode, functionName, HRUserUtils.getUser().getTenantId(), status, null)',
    ]) expect(service).toContain(fragment)
    for (const fragment of [
      'id, function_code, function_name, tenant_id, status, remarks',
      'where del_flag = 0',
      'updateStatusById',
      'id = #{id}',
    ]) expect(mapper).toContain(fragment)
    for (const field of ['functionCode', 'functionName', 'status']) expect(entity).toContain(field)

    expect(productSettingFunctionUseCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_FUNCTION_USE_METHODS))
    expect(productSettingFunctionUseCapabilities.every(item => item.pagePath === PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH && item.permission === PRODUCT_SETTING_FUNCTION_USE_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_FUNCTION_USE_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_SETTING_FUNCTION_USE_QUERY_PERMISSION).toBe('management:function-use:query')
    expect(PRODUCT_SETTING_FUNCTION_USE_SUBMIT_PERMISSION).toBe('management:function-use:submit')
  })

  it('列表、null-id首次启用和非空ID停用按Portal逐字段发送', async () => {
    const f = fixture([{ list: [row] }])
    await expect(f.api.list()).resolves.toEqual([row])
    const prepared = f.api.prepareSwitch({ current: row })
    expect(prepared).toEqual({
      draft: { id: null, functionCode: 'demo.function', functionName: '演示功能', status: 1 },
      previous: { id: null, functionCode: 'demo.function', functionName: '演示功能', status: 0 },
    })
    await expect(f.api.switchStatus(prepared)).resolves.toBe(true)
    await expect(f.api.switchStatus({ draft: { id: 'tenant-row-1', functionCode: 'demo.function', functionName: '演示功能', status: 0 } })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/config/functionUse/list', method: 'get', params: { order: '', orderField: '' } },
      { url: '/config/functionUse/openOrClose', method: 'get', params: { id: null, functionCode: 'demo.function', functionName: '演示功能', status: 1 } },
      { url: '/config/functionUse/openOrClose', method: 'get', params: { id: 'tenant-row-1', functionCode: 'demo.function', functionName: '演示功能', status: 0 } },
    ])
  })

  it('错误状态、空编码和坏响应在发请求前或响应处失败，并覆盖反证', async () => {
    const f = fixture([])
    expect(() => f.api.prepareSwitch({ current: { ...row, status: null } })).toThrow('status')
    expect(() => f.api.prepareSwitch({ current: { ...row, functionCode: ' ' } })).toThrow('functionCode')
    await expect(f.api.switchStatus({ draft: { ...row, status: 2 as never } })).rejects.toThrow('status')
    await expect(f.api.list()).rejects.toThrow('对象')
    expect(f.calls).toEqual([{ url: '/config/functionUse/list', method: 'get', params: { order: '', orderField: '' } }])
    await expect(fixture([{}]).api.list()).rejects.toThrow('list数组')
    await expect(fixture([{ list: [{ ...row, status: 2 }] }]).api.list()).rejects.toThrow('status')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual([row])
    expect(captured.calls[0]?.url).toBe('/config/functionUse/list')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖三个公开方法、null-id语义、权限和写后回查', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_FUNCTION_USE_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_FUNCTION_USE_METHODS).map(method => `productSettingFunctionUse.${method}`).sort())
    expect(contracts['product-setting-function-use-prepare-switch']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['draft.id', 'draft.status', 'previous.status']))
    expect(contracts['product-setting-function-use-switch-status']?.steps.some(step => step.capabilityId === 'product-setting-function-use-list')).toBe(true)
    expect(contracts['product-setting-function-use-switch-status']?.boundaries.join('\n')).toContain('id为null')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingFunctionUseCapabilities, contracts })).toEqual([])
  })
})
