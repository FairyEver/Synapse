import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductHatcheryLibCapability,
  PRODUCT_HATCHERY_LIB_METHODS,
  PRODUCT_HATCHERY_LIB_PAGE_PATH,
  PRODUCT_HATCHERY_LIB_PERMISSION,
  productHatcheryLibCapabilities,
} from '../src/capabilities/product-hatchery-lib.js'
import { PRODUCT_HATCHERY_LIB_AI_CONTRACTS as contracts } from '../src/catalog/contracts-product-hatchery-lib.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductHatcheryLibCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Portal 孵化预案 → 标准库页面能力', () => {
  it('逐页锁定包装路由、孵化权限与实际复用组件', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/lib.vue')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/lib/list.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/lib/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/lib/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/programNew/StandardLibController.java')
    expect(menu).toContain(`path: '${PRODUCT_HATCHERY_LIB_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_HATCHERY_LIB_PERMISSION}'`)
    expect(route).toContain(PRODUCT_HATCHERY_LIB_PERMISSION)
    expect(wrapper).toContain("import HatchManageLibList from 'app/portal/views/dashboard/product/setting/hatch-manage/lib/list.vue'")
    for (const fragment of ["import { http } from 'app/portal/utils/http/product.js'", "http.get('/programNew/standardLib/getPage'", "http.post('/programNew/standardLib/importStandardLib'", "http.post('/programNew/standardLib/edit'", "http.get('/programNew/standardLib/delete'", "http.get('/programNew/baseSetting/temp/getTempInList'"]) expect(list).toContain(fragment)
    for (const fragment of ['variety', 'gen', 'tempId', 'file', 'suiteCode']) expect(modal).toContain(fragment)
    for (const endpoint of ['/getPage', '/edit', '/delete', '/importStandardLib']) expect(controller).toContain(endpoint)
    expect(productHatcheryLibCapabilities.every(item => item.pagePath === PRODUCT_HATCHERY_LIB_PAGE_PATH && item.permission === PRODUCT_HATCHERY_LIB_PERMISSION && item.httpInstance === 'product' && item.moduleType === null)).toBe(true)
  })

  it('复用组件的列表、温度候选和二阶段导入行为保持不变', async () => {
    const f = fixture([
      [{ id: 'temp-1', inTitle: '温度一' }],
      { page: { records: [{ variety: 'V1', varietyName: '品种一', gen: 'G1', genName: '一代', tempId: 'temp-1', tempName: '温度一', suiteCode: 'suite-1' }], total: 1 } },
      { flag: 1 },
      {},
    ])
    await expect(f.api.temperatureOptions()).resolves.toEqual([{ id: 'temp-1', inTitle: '温度一', label: '温度一', value: 'temp-1' }])
    await expect(f.api.list({ variety: 'V1', gen: 'G1', tempId: 'temp-1', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    const prepared = f.api.prepareCreate({ variety: 'V1', gen: 'G1', tempId: 'temp-1', file: { fileName: '标准.xlsx', base64: 'YQ==' } })
    await expect(f.api.create(prepared)).resolves.toEqual({ status: 'conflict', flag: 1 })
    await expect(f.api.create({ ...prepared, flag: 2 })).resolves.toEqual({ status: 'submitted' })
    expect(f.calls[1]).toEqual({ url: '/programNew/standardLib/getPage', method: 'get', params: { order: '', orderField: '', variety: 'V1', gen: 'G1', tempId: 'temp-1', scope: 1, pageNo: 2, pageSize: 50 } })
    expect(f.calls[2]?.url).toBe('/programNew/standardLib/importStandardLib')
    expect(f.calls[3]?.url).toBe('/programNew/standardLib/importStandardLib')
    expect(f.calls[3]?.data).toBeInstanceOf(FormData)
    expect((f.calls[3]?.data as FormData).get('flag')).toBe('2')
  })

  it('AI契约重新绑定到孵化页面路径与权限，且保留prepare→submit→cancel', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_HATCHERY_LIB_METHODS).sort())
    expect(contracts['product-hatchery-lib-prepare-create']?.whenToUse).toContain(PRODUCT_HATCHERY_LIB_PAGE_PATH)
    expect(contracts['product-hatchery-lib-prepare-create']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['product-hatchery-lib-create']?.steps[0]?.capabilityId).toBe('product-hatchery-lib-create')
    expect(contracts['product-hatchery-lib-create']?.boundaries.join('\n')).toContain(PRODUCT_HATCHERY_LIB_PERMISSION)
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productHatcheryLibCapabilities, contracts })).toEqual([])
  })

  it('Portal文件和分页边界不被静默放宽', () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ variety: 'V1', gen: 'G1', tempId: 'T1', file: { fileName: 'x.txt', base64: 'YQ==' } })).toThrow('xls或xlsx')
    expect(() => f.api.prepareCreate({ variety: 'V1', gen: 'G1', tempId: 'T1', file: { fileName: 'x.xlsx', base64: 'bad' } })).toThrow('Base64')
    expect(() => f.api.prepareRemove({ suiteCode: '' })).toThrow('suiteCode')
    expect(f.calls).toEqual([])
  })
})
