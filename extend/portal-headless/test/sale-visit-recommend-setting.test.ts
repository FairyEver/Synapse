import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createSaleVisitRecommendSettingCapability,
  SALE_VISIT_RECOMMEND_SETTING_METHODS,
  SALE_VISIT_RECOMMEND_SETTING_MODULE_TYPE,
  SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH,
  SALE_VISIT_RECOMMEND_SETTING_PERMISSION,
  saleVisitRecommendSettingCapabilities,
  type SaleVisitRecommendSettingForm,
} from '../src/capabilities/sale-visit-recommend-setting.js'
import {
  SALE_VISIT_RECOMMEND_SETTING_AI_CONTRACTS as contracts,
  SALE_VISIT_RECOMMEND_SETTING_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-sale-visit-recommend-setting.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: SaleVisitRecommendSettingForm = {
  advancePushDays: 3,
  visitLateSubmitDays: 5,
  totalPercent: 20,
  businessServiceRatio: '5',
  keyDayItems: [
    { keyDay: 30, pushPoint: '  关注客户  ' },
    { keyDay: 99, pushPoint: '关键日龄提示' },
  ],
}

const detail = {
  setting: {
    advancePushDays: 3,
    visitLateSubmitDays: 5,
    recommendRatio: 20,
    businessServiceRatio: '5',
  },
  keyAgeSettings: [
    { keyAge: 30, pushPoint: '关注客户' },
    { keyAge: 99, pushPoint: '关键日龄提示' },
  ],
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSaleVisitRecommendSettingCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function captureHttp () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    const data = String(config.url).includes('/recommend-setting/get') ? detail : true
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  const api = createSaleVisitRecommendSettingCapability(config => call(
    SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH,
    config as PortalRequestConfig,
  ))
  return { api, calls }
}

describe('Portal 销售设置 → 推荐设置页面能力', () => {
  it('锁定页面、权限、platform实例、module-type和纯表单动作', () => {
    expect(saleVisitRecommendSettingCapabilities.map(item => item.id)).toEqual(Object.keys(SALE_VISIT_RECOMMEND_SETTING_METHODS))
    expect(saleVisitRecommendSettingCapabilities.every(item => item.pagePath === SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH)).toBe(true)
    expect(saleVisitRecommendSettingCapabilities.every(item => item.permission === SALE_VISIT_RECOMMEND_SETTING_PERMISSION)).toBe(true)
    expect(saleVisitRecommendSettingCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(saleVisitRecommendSettingCapabilities.every(item => item.moduleType === SALE_VISIT_RECOMMEND_SETTING_MODULE_TYPE)).toBe(true)
    expect(saleVisitRecommendSettingCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'sale-visit-recommend-setting-save',
    ])
    expect(resolveModuleType(SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH)).toMatchObject({ moduleType: 60, label: '销售系统' })
  })

  it('逐页锁定Portal路径、表单规则、动态字典和没有列表筛选/删除请求', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const source = read(portalRoot, 'app/portal/views/dashboard/sale/visit/recommend-setting/list.vue')
    expect(menu).toContain(`path: '${SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALE_VISIT_RECOMMEND_SETTING_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "http.get('/admin-api/sales/recommend-setting/get')",
      "http.post('/admin-api/sales/recommend-setting/save', payload)",
      'advancePushDays: null',
      'visitLateSubmitDays: null',
      'totalPercent: null',
      "businessServiceRatio: '5'",
      'type="business_analog_services"',
      ':min="1"',
      ':max="29"',
      ':min="0"',
      ':max="100"',
      'keyDayItems.length <= 1',
      '关键日龄不允许完全相同',
      'String(item.pushPoint ?? \'\').trim()',
      'await loadRecommendSetting()',
    ]) expect(source).toContain(fragment)
    expect(source).not.toContain('getDataListURL')
    expect(source).not.toContain('http.delete(')
    expect(source).not.toContain('recommend-setting/key-age/push-point')
  })

  it('锁定Java权限、字段校验、当前租户整批替换和详情响应边界', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/visitchecklist/RecommendSettingController.java')
    const service = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/service/visitchecklist/RecommendSettingServiceImpl.java')
    const settingReq = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/visitchecklist/vo/RecommendSettingSaveReqVO.java')
    const keyAgeReq = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/visitchecklist/vo/KeyAgeSettingSaveReqVO.java')
    const detailResp = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/visitchecklist/vo/RecommendSettingDetailRespVO.java')
    expect(controller).toContain('@RequestMapping("/sales/recommend-setting")')
    expect(controller).toContain('@PostMapping("/save")')
    expect(controller).toContain('@GetMapping("/get")')
    expect(controller).toContain(`@PreAuthorize("@ss.hasPermission('${SALE_VISIT_RECOMMEND_SETTING_PERMISSION}')")`)
    expect(settingReq).toContain('@Min(value = 1')
    expect(settingReq).toContain('@Max(value = 29')
    expect(settingReq).toContain('@Min(value = 0')
    expect(settingReq).toContain('@Max(value = 100')
    expect(keyAgeReq).toContain('@Min(value = 0')
    expect(keyAgeReq).toContain('@Size(max = 100')
    expect(service).toContain('TenantContextHolder.getTenantId()')
    expect(service).toContain('keyAgeSettingMapper.delete(KeyAgeSettingDO::getTenantId, tenantId)')
    expect(service).toContain('keyAgeSettingMapper.insert(keyAgeDO)')
    expect(detailResp).toContain('private SettingInfo setting;')
    expect(detailResp).toContain('private List<KeyAgeInfo> keyAgeSettings;')
    expect(detailResp).not.toContain('private Long id;')
  })

  it('读取详情归一空容器，保留页面字段，不伪造列表或筛选参数', async () => {
    const f = fixture([{ setting: null, keyAgeSettings: null }])
    await expect(f.api.get()).resolves.toEqual({ setting: null, keyAgeSettings: [] })
    expect(f.calls).toEqual([{ url: '/admin-api/sales/recommend-setting/get', method: 'get' }])
  })

  it('prepare逐字段复刻页面载荷、固定id和提交前校验', async () => {
    const f = fixture([true])
    const prepared = f.api.prepareSave({ form })
    expect(prepared).toEqual({
      draft: {
        setting: { id: 0, advancePushDays: 3, visitLateSubmitDays: 5, recommendRatio: 20, businessServiceRatio: '5' },
        keyAgeSettings: [
          { id: 0, keyAge: 30, pushPoint: '关注客户' },
          { id: 0, keyAge: 99, pushPoint: '关键日龄提示' },
        ],
      },
    })
    expect(f.calls).toHaveLength(0)
    await expect(f.api.save(prepared)).resolves.toBe(true)
    expect(f.calls).toEqual([{ url: '/admin-api/sales/recommend-setting/save', method: 'post', data: prepared.draft }])

    const invalid = fixture([])
    expect(() => invalid.api.prepareSave({ form: { ...form, advancePushDays: 0 } })).toThrow('advancePushDays')
    expect(() => invalid.api.prepareSave({ form: { ...form, totalPercent: 101 } })).toThrow('totalPercent')
    expect(() => invalid.api.prepareSave({ form: { ...form, keyDayItems: [{ keyDay: 1, pushPoint: 'a' }, { keyDay: 1, pushPoint: 'b' }] } })).toThrow('不允许完全相同')
    expect(() => invalid.api.prepareSave({ form: { ...form, keyDayItems: [{ keyDay: 1, pushPoint: 'x'.repeat(101) }] } })).toThrow('100')
    expect(invalid.calls).toHaveLength(0)
  })

  it('保存非true或网络失败保持失败语义，且不把保存成功当作回查结果', async () => {
    const bad = fixture([false])
    const prepared = bad.api.prepareSave({ form })
    await expect(bad.api.save(prepared)).rejects.toThrow('不是true')
    const failed = fixture([new Error('权限不足')])
    await expect(failed.api.save(prepared)).rejects.toThrow('权限不足')
    expect(failed.calls).toHaveLength(1)
  })

  it('platform请求携带租户和module-type头，GET/POST使用同一页面实例', async () => {
    const captured = captureHttp()
    await captured.api.get()
    const prepared = captured.api.prepareSave({ form })
    await captured.api.save(prepared)
    expect(captured.calls).toHaveLength(2)
    for (const config of captured.calls) {
      expect(config.headers.get('tenant-id')).toBe('7')
      expect(config.headers.get('token')).toBe('fixture-token')
      expect(config.headers.get('module-type')).toBe('60')
    }
    expect(captured.calls[0]?.url).toContain('/admin-api/sales/recommend-setting/get')
    expect(captured.calls[1]?.url).toContain('/admin-api/sales/recommend-setting/save')
    expect(captured.calls[1]?.method).toBe('post')
  })

  it('AI契约覆盖能力/公开方法、保存后回查和未完成证据', async () => {
    expect(Object.keys(contracts)).toEqual(saleVisitRecommendSettingCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual([
      'saleVisitRecommendSetting.get',
      'saleVisitRecommendSetting.prepareSave',
      'saleVisitRecommendSetting.save',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: saleVisitRecommendSettingCapabilities, contracts })).toEqual([])
    expect(validateAiContracts(contracts, { profile: 'complete', definitions: saleVisitRecommendSettingCapabilities, contracts }).map((issue: { code: string }) => issue.code)).toEqual(Array(3).fill('incomplete-evidence'))
    expect(contracts['sale-visit-recommend-setting-save']?.steps[0]).toMatchObject({ capabilityId: 'sale-visit-recommend-setting-get', mapping: {} })
    expect(contracts['sale-visit-recommend-setting-prepare-save']?.steps[0]).toMatchObject({ mapping: { draft: 'result.draft' } })
    expect(contracts['sale-visit-recommend-setting-save']?.idempotency).toContain('没有requestId')
    expect(Object.values(contracts).every(contract => contract.evidence.some(item => item.kind === 'reference'))).toBe(true)
    expect(Object.values(contracts).every(contract => contract.gaps?.some(gap => gap.includes('真实测试环境smoke未执行')))).toBe(true)
  })

  it('反证：错误映射和缺少关键输出字段会被锁定/拒绝', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    const broken = {
      ...contracts,
      'sale-visit-recommend-setting-prepare-save': {
        ...contracts['sale-visit-recommend-setting-prepare-save']!,
        steps: [{
          ...contracts['sale-visit-recommend-setting-prepare-save']!.steps[0]!,
          mapping: { draft: 'result.setting' },
        }],
      },
    }
    expect(validateAiContracts(broken, { definitions: saleVisitRecommendSettingCapabilities, contracts: broken }).map((issue: { code: string }) => issue.code)).toContain('unknown-source-field')
    expect(contracts['sale-visit-recommend-setting-get']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining([
      'setting.recommendRatio',
      'setting.businessServiceRatio',
      'keyAgeSettings[].keyAge',
      'keyAgeSettings[].pushPoint',
    ]))
  })
})
